import { AI_SYSTEM_INSTRUCTION } from "../config/env";
import { adaptiveAIRouterService } from "../services/adaptive-ai-router.service";
import type { AIChatRequest, AIChatResponse, AIProviderId } from "../services/ai-provider.types";
import { GeminiService, type AssistantGuidance, type GenerateReplyOptions, type GeminiMessage } from "./gemini.service";
import type { ApiKeyPoolService } from "../services/api-key-pool.service";

export class AdaptiveGeminiService extends GeminiService {
  private readonly routingEnabled = String(process.env.AI_MULTI_PROVIDER_ROUTING_ENABLED ?? "true").toLowerCase() !== "false";

  private canRoute(options?: GenerateReplyOptions): boolean {
    if (!this.routingEnabled) return false;
    if (options?.attachments?.length) return false;
    if (options?.enableSearch) return false;
    if (options?.hasAudio || options?.hasVisionOrDocument) return false;
    return true;
  }

  private toRequest(history: GeminiMessage[], message: string, guidance?: AssistantGuidance | string): AIChatRequest {
    const personality = typeof guidance === "string" ? guidance : guidance?.personalityInstruction;
    const mode = typeof guidance === "string" ? undefined : guidance?.modeInstruction;
    const memory = typeof guidance === "string" ? undefined : guidance?.memoryInstruction;
    const system = [AI_SYSTEM_INSTRUCTION, personality ? `Personality guidance:\n${personality}` : "", mode ? `Assistant mode guidance:\n${mode}` : "", memory || ""].filter(Boolean).join("\n\n");
    return {
      model: "",
      messages: [
        { role: "system", content: system },
        ...history.map((item) => ({ role: item.role === "model" ? "assistant" as const : "user" as const, content: item.content })),
        { role: "user", content: message },
      ],
    };
  }

  private context(options?: GenerateReplyOptions) {
    return {
      mode: options?.mode,
      isDeepReasoning: options?.isDeepReasoning,
      isExtraction: options?.isExtraction,
      enableSearch: false,
      requiresVision: false,
      requiresTools: false,
    };
  }

  constructor(apiKeyOrPool: string | ApiKeyPoolService, model: string, timeoutMs: number, systemInstruction = AI_SYSTEM_INSTRUCTION) {
    super(apiKeyOrPool, model, timeoutMs, systemInstruction);
  }

  override async generateReply(history: GeminiMessage[], message: string, guidance?: AssistantGuidance | string, options?: GenerateReplyOptions): Promise<string> {
    if (!this.canRoute(options)) return super.generateReply(history, message, guidance, options);
    const request = this.toRequest(history, message, guidance);
    const result = await adaptiveAIRouterService.route(request, this.context(options), async () => {
      const text = await super.generateReply(history, message, guidance, options);
      return { provider: "gemini" as AIProviderId, model: process.env.GEMINI_MODEL?.trim() || "", text } satisfies AIChatResponse;
    });
    return result.response.text.trim();
  }

  override async generateReplyStream(history: GeminiMessage[], message: string, guidance?: AssistantGuidance | string, options?: GenerateReplyOptions, onChunk?: (accumulatedText: string) => Promise<void> | void): Promise<string> {
    if (!this.canRoute(options)) return super.generateReplyStream(history, message, guidance, options, onChunk);

    const context = this.context(options);
    const candidates = await adaptiveAIRouterService.candidates(context);
    const first = candidates[0];

    // Keep Gemini's native streaming + multi-key pool when Gemini wins the adaptive decision.
    // For non-Gemini winners, use the unified provider stream with transparent fallback.
    if (first?.model.provider === "gemini") {
      try {
        return await super.generateReplyStream(history, message, guidance, options, onChunk);
      } catch (error) {
        adaptiveAIRouterService.recordFailure(first.model.id, error);
        throw error;
      }
    }

    const request = this.toRequest(history, message, guidance);
    let accumulated = "";
    let lastDelivered = "";
    for await (const chunk of adaptiveAIRouterService.routeStream(request, context)) {
      if (chunk.delta) {
        accumulated += chunk.delta;
        if (onChunk && accumulated !== lastDelivered) {
          lastDelivered = accumulated;
          await onChunk(accumulated);
        }
      }
    }
    if (!accumulated) throw new Error("Adaptive AI router returned an empty response.");
    return accumulated.trim();
  }

  static create(apiKeyOrPool: string | ApiKeyPoolService, model: string, timeoutMs: number): AdaptiveGeminiService {
    return new AdaptiveGeminiService(apiKeyOrPool, model, timeoutMs);
  }
}
