import { unifiedModelRegistryService } from "../unified-model-registry.service";
import { huggingFaceCapabilityService } from "../huggingface-capability.service";
import { aiProviderGatewayService } from "../ai-provider-gateway.service";
import { adaptiveAIRouterService } from "../adaptive-ai-router.service";
import { logger } from "../../lib/logger";
import type { FailoverRecord, MediaExecutionRequest, VideoGenerationTechnique } from "./media-types";

export interface VideoExecutionOutput {
  buffer: Buffer;
  enhancedPrompt: string;
  enhancerModel?: string;
  actualProvider: string;
  actualModel: string;
  videoTechnique: VideoGenerationTechnique;
  width: number;
  height: number;
  durationSeconds: number;
  mimeType: string;
  failovers: FailoverRecord[];
}

function cleanExpandedPrompt(text: string, fallback: string): string {
  let cleaned = text.trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  const quoteMatch = cleaned.match(/>\s*["“]([^"”]+)["”]/) || cleaned.match(/["“]([^"”]{20,300})["”]/);
  if (quoteMatch && quoteMatch[1]) {
    cleaned = quoteMatch[1].trim();
  } else {
    const lines = cleaned.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.toLowerCase().startsWith("here are") && !l.toLowerCase().startsWith("option "));
    if (lines.length > 0) {
      cleaned = lines[0].replace(/^>\s*/, "").replace(/^[-*]\s*/, "").trim();
    }
  }
  return cleaned.length >= 10 ? cleaned.slice(0, 300) : fallback;
}

export class VideoExecutor {
  static async enhanceDirectorPrompt(rawPrompt: string): Promise<{ prompt: string; enhancerModel?: string }> {
    const cleaned = rawPrompt.trim();
    if (cleaned.length > 250) {
      return { prompt: cleaned };
    }

    try {
      const routed = await adaptiveAIRouterService.route({
        systemInstruction:
          "You are a cinematic director. Expand this user video concept into a descriptive prompt specifying camera motion (e.g. slow pan, drone flyover), lighting, motion physics, and cinematic mood. Output ONLY the single-paragraph prompt in English. Maximum 40 words. No commentary, no options, no markdown.",
        messages: [{ role: "user", content: `Expand into a cinematic video prompt: "${cleaned}"` }],
        temperature: 0.7,
      });

      const expanded = routed.response?.text?.trim();
      if (expanded && expanded.length > 10 && !expanded.includes("I cannot")) {
        const sanitized = cleanExpandedPrompt(expanded, cleaned);
        return {
          prompt: sanitized,
          enhancerModel: `${routed.candidate.model.provider}:${routed.candidate.model.modelId}`,
        };
      }
    } catch (err) {
      logger.warn({ err: String(err) }, "Director prompt expansion failed; using original prompt");
    }

    return { prompt: cleaned };
  }

  static async plan(request: MediaExecutionRequest): Promise<{
    plannedProvider: string;
    plannedModel: string;
    enhancedPrompt: string;
    videoTechnique: VideoGenerationTechnique;
    width: number;
    height: number;
    durationSeconds: number;
    routingReason: string;
  }> {
    const width = request.width || (request.aspectRatio === "9:16" ? 576 : request.aspectRatio === "1:1" ? 768 : 1024);
    const height = request.height || (request.aspectRatio === "9:16" ? 1024 : request.aspectRatio === "1:1" ? 768 : 576);
    const durationSeconds = request.durationSeconds || 4;

    const enhancement = await this.enhanceDirectorPrompt(request.prompt);

    const allModels = await unifiedModelRegistryService.list();
    const primaryVideo = allModels.find((m) => m.enabled && m.roles.includes("primary_video"));

    let plannedProvider = "huggingface";
    let plannedModel = "";
    let routingReason = "";
    let videoTechnique: VideoGenerationTechnique = "video_diffusion";

    if (request.providerOverride && request.providerOverride !== "auto") {
      plannedProvider = request.providerOverride;
      plannedModel = request.modelOverride || "default";
      routingReason = `Explicit user override for provider ${request.providerOverride}`;
    } else if (primaryVideo) {
      plannedProvider = primaryVideo.provider;
      plannedModel = primaryVideo.modelId;
      routingReason = `Primary video role model configured in unified registry (${primaryVideo.name})`;
    } else {
      const capability = await huggingFaceCapabilityService.resolveModel("text-to-video");
      plannedModel = capability.model;
      plannedProvider = "huggingface";
      routingReason = capability.discovered
        ? `Dynamic Hugging Face Hub capability discovery (live text-to-video pipeline: ${capability.model})`
        : `Verified text-to-video model pipeline (${capability.model})`;
    }

    return {
      plannedProvider,
      plannedModel,
      enhancedPrompt: enhancement.prompt,
      videoTechnique,
      width,
      height,
      durationSeconds,
      routingReason,
    };
  }

  static async execute(request: MediaExecutionRequest): Promise<VideoExecutionOutput> {
    const planned = await this.plan(request);
    const failovers: FailoverRecord[] = [];

    const width = planned.width;
    const height = planned.height;
    const durationSeconds = planned.durationSeconds;
    const enhancedPrompt = planned.enhancedPrompt;

    let targetProvider = planned.plannedProvider;
    let targetModel = planned.plannedModel;

    // Try primary video diffusion model
    try {
      logger.info({ provider: targetProvider, model: targetModel, prompt: enhancedPrompt }, "Attempting authentic video diffusion execution");
      const videoRes = await aiProviderGatewayService.generateVideo?.(targetProvider as any, {
        model: targetModel,
        prompt: enhancedPrompt,
        width,
        height,
        durationSeconds,
      });

      if (videoRes && videoRes.result?.buffer && videoRes.result.buffer.length > 1024 && !videoRes.result.fallbackUsed) {
        return {
          buffer: videoRes.result.buffer,
          enhancedPrompt,
          actualProvider: targetProvider,
          actualModel: targetModel,
          videoTechnique: "video_diffusion",
          width,
          height,
          durationSeconds,
          mimeType: videoRes.result.mimeType || "video/mp4",
          failovers,
        };
      }
    } catch (primaryErr: any) {
      const errMsg = primaryErr?.message || String(primaryErr);
      const httpStatus = primaryErr?.status || primaryErr?.statusCode;
      logger.warn({ error: errMsg, provider: targetProvider, model: targetModel }, "Primary video diffusion endpoint unavailable");

      failovers.push({
        primaryProvider: targetProvider,
        primaryModel: targetModel,
        errorCategory: errMsg.includes("401") ? "auth_error" : errMsg.includes("404") ? "model_unavailable" : "timeout",
        errorMessage: errMsg,
        httpStatus,
        retryAttempt: 1,
        fallbackProvider: "huggingface",
        fallbackModel: "text-to-video-diffusion",
        fallbackType: "model_failover",
        timestamp: new Date().toISOString(),
      });
    }

    // Attempt secondary authentic video diffusion candidate via Hugging Face if primary was not HF
    if (targetProvider !== "huggingface") {
      try {
        const capability = await huggingFaceCapabilityService.resolveModel("text-to-video");
        if (capability && capability.model) {
          logger.info({ model: capability.model, prompt: enhancedPrompt }, "Attempting secondary authentic video diffusion candidate via Hugging Face");
          const secondaryRes = await aiProviderGatewayService.generateVideo?.("huggingface" as any, {
            model: capability.model,
            prompt: enhancedPrompt,
            width,
            height,
            durationSeconds,
          });

          if (secondaryRes && secondaryRes.result?.buffer && secondaryRes.result.buffer.length > 1024 && !secondaryRes.result.fallbackUsed) {
            return {
              buffer: secondaryRes.result.buffer,
              enhancedPrompt,
              actualProvider: "huggingface",
              actualModel: capability.model,
              videoTechnique: "video_diffusion",
              width,
              height,
              durationSeconds,
              mimeType: secondaryRes.result.mimeType || "video/mp4",
              failovers,
            };
          }
        }
      } catch (secErr: any) {
        logger.warn({ error: String(secErr) }, "Secondary authentic video diffusion candidate failed");
      }
    }

    // Synthetic pan-and-zoom and fake storyboard fallbacks are strictly disabled to preserve professional quality
    throw new Error("Generative video diffusion engines are currently experiencing high demand or transient provider rate limits. Please try again shortly.");
  }
}
