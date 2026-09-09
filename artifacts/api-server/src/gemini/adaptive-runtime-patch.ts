import { AI_SYSTEM_INSTRUCTION } from "../config/env";
import { adaptiveAIRouterService } from "../services/adaptive-ai-router.service";
import type { AIChatResponse, AIProviderId } from "../services/ai-provider.types";
import { GeminiService, type AssistantGuidance, type GenerateReplyOptions, type GeminiMessage } from "./gemini.service";

const PATCH_FLAG = Symbol.for("wingbuddy.adaptive-gemini-service-patched");

type PatchedGeminiService = GeminiService & { [PATCH_FLAG]?: boolean };

function routingEnabled(): boolean {
  return String(process.env.AI_MULTI_PROVIDER_ROUTING_ENABLED ?? "true").toLowerCase() !== "false";
}

function canRoute(options?: GenerateReplyOptions): boolean {
  if (!routingEnabled()) return false;
  if (options?.attachments?.length || options?.enableSearch) return false;
  if (options?.hasAudio || options?.hasVisionOrDocument) return false;
  return true;
}

function toRequest(history: GeminiMessage[], message: string, guidance?: AssistantGuidance | string) {
  const personality = typeof guidance === "string" ? guidance : guidance?.personalityInstruction;
  const mode = typeof guidance === "string" ? undefined : guidance?.modeInstruction;
  const memory = typeof guidance === "string" ? undefined : guidance?.memoryInstruction;
  return {
    model: "",
    messages: [
      { role: "system" as const, content: [AI_SYSTEM_INSTRUCTION, personality ? `Personality guidance:\n${personality}` : "", mode ? `Assistant mode guidance:\n${mode}` : "", memory || ""].filter(Boolean).join("\n\n") },
      ...history.map((item) => ({ role: item.role === "model" ? "assistant" as const : "user" as const, content: item.content })),
      { role: "user" as const, content: message },
    ],
  };
}

function routingContext(options?: GenerateReplyOptions) {
  return {
    mode: options?.mode,
    isDeepReasoning: options?.isDeepReasoning,
    isExtraction: options?.isExtraction,
    enableSearch: false,
    requiresVision: false,
    requiresTools: false,
  };
}

const prototype = GeminiService.prototype as PatchedGeminiService;
if (!prototype[PATCH_FLAG]) {
  const originalGenerateReply = GeminiService.prototype.generateReply;
  const originalGenerateReplyStream = GeminiService.prototype.generateReplyStream;

  GeminiService.prototype.generateReply = async function patchedGenerateReply(history: GeminiMessage[], message: string, guidance?: AssistantGuidance | string, options?: GenerateReplyOptions): Promise<string> {
    if (!canRoute(options)) return originalGenerateReply.call(this, history, message, guidance, options);
    const result = await adaptiveAIRouterService.route(toRequest(history, message, guidance), routingContext(options), async () => {
      const text = await originalGenerateReply.call(this, history, message, guidance, options);
      return { provider: "gemini" as AIProviderId, model: process.env.GEMINI_MODEL?.trim() || "", text } satisfies AIChatResponse;
    });
    return result.response.text.trim();
  };

  GeminiService.prototype.generateReplyStream = async function patchedGenerateReplyStream(history: GeminiMessage[], message: string, guidance?: AssistantGuidance | string, options?: GenerateReplyOptions, onChunk?: (accumulatedText: string) => Promise<void> | void): Promise<string> {
    if (!canRoute(options)) return originalGenerateReplyStream.call(this, history, message, guidance, options, onChunk);
    const context = routingContext(options);
    const candidates = await adaptiveAIRouterService.candidates(context);
    const first = candidates[0];

    if (first?.model.provider === "gemini") {
      try {
        return await originalGenerateReplyStream.call(this, history, message, guidance, options, onChunk);
      } catch (error) {
        adaptiveAIRouterService.recordFailure(first.model.id, error);
        throw error;
      }
    }

    const request = toRequest(history, message, guidance);
    let accumulated = "";
    for await (const chunk of adaptiveAIRouterService.routeStream(request, context)) {
      if (!chunk.delta) continue;
      accumulated += chunk.delta;
      if (onChunk) await onChunk(accumulated);
    }
    if (!accumulated.trim()) throw new Error("Adaptive AI router returned an empty response.");
    return accumulated.trim();
  };

  prototype[PATCH_FLAG] = true;
}
