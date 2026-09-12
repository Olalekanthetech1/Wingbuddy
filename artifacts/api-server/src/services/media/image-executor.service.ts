import { unifiedModelRegistryService } from "../unified-model-registry.service";
import { huggingFaceCapabilityService } from "../huggingface-capability.service";
import { aiProviderGatewayService } from "../ai-provider-gateway.service";
import { adaptiveAIRouterService } from "../adaptive-ai-router.service";
import { logger } from "../../lib/logger";
import type { FailoverRecord, MediaExecutionRequest } from "./media-types";

export interface ImageExecutionOutput {
  buffer: Buffer;
  enhancedPrompt: string;
  enhancerModel?: string;
  actualProvider: string;
  actualModel: string;
  route: "inference_provider" | "community";
  sourceUrl?: string;
  width: number;
  height: number;
  mimeType: string;
  failovers: FailoverRecord[];
}

export class ImageExecutor {
  static async enhancePrompt(rawPrompt: string): Promise<{ prompt: string; enhancerModel?: string }> {
    const cleaned = rawPrompt.trim();
    if (cleaned.length > 250) {
      return { prompt: cleaned };
    }

    try {
      const routed = await adaptiveAIRouterService.route({
        systemInstruction:
          "You are an expert prompt artist. Expand this image concept into a rich, detailed visual description specifying artistic style, lighting, composition, and fine textures. Output ONLY the prompt string in English with no quotes or commentary.",
        messages: [{ role: "user", content: `Expand into an image prompt: "${cleaned}"` }],
        temperature: 0.7,
      });

      const expanded = routed.response?.text?.trim();
      if (expanded && expanded.length > 10 && !expanded.includes("I cannot")) {
        return {
          prompt: expanded,
          enhancerModel: `${routed.candidate.model.provider}:${routed.candidate.model.modelId}`,
        };
      }
    } catch (err) {
      logger.warn({ err: String(err) }, "Adaptive prompt enhancement failed; using original prompt");
    }

    return { prompt: cleaned };
  }

  static async plan(request: MediaExecutionRequest): Promise<{
    plannedProvider: string;
    plannedModel: string;
    enhancedPrompt: string;
    width: number;
    height: number;
    routingReason: string;
  }> {
    const width = request.width || (request.aspectRatio === "16:9" ? 1280 : request.aspectRatio === "9:16" ? 720 : 1024);
    const height = request.height || (request.aspectRatio === "16:9" ? 720 : request.aspectRatio === "9:16" ? 1280 : 1024);

    const enhancement = await this.enhancePrompt(request.prompt);
    
    // Resolve dynamic model from registry or live Hugging Face Hub capability
    const allModels = await unifiedModelRegistryService.list();
    const primaryImage = allModels.find((m) => m.enabled && m.roles.includes("primary_image"));

    let plannedProvider = "huggingface";
    let plannedModel = "";
    let routingReason = "";

    if (request.providerOverride && request.providerOverride !== "auto") {
      plannedProvider = request.providerOverride;
      plannedModel = request.modelOverride || "default";
      routingReason = `Explicit user override for provider ${request.providerOverride}`;
    } else if (primaryImage) {
      plannedProvider = primaryImage.provider;
      plannedModel = primaryImage.modelId;
      routingReason = `Primary image role model configured in unified registry (${primaryImage.name})`;
    } else {
      const capability = await huggingFaceCapabilityService.resolveModel("text-to-image");
      plannedModel = capability.model;
      plannedProvider = "huggingface";
      routingReason = capability.discovered
        ? `Dynamic Hugging Face Hub capability discovery (live pipeline tag text-to-image: ${capability.model})`
        : `Default verified text-to-image endpoint (${capability.model})`;
    }

    return {
      plannedProvider,
      plannedModel,
      enhancedPrompt: enhancement.prompt,
      width,
      height,
      routingReason,
    };
  }

  static async execute(request: MediaExecutionRequest): Promise<ImageExecutionOutput> {
    const planned = await this.plan(request);
    const failovers: FailoverRecord[] = [];

    const width = planned.width;
    const height = planned.height;
    const enhancedPrompt = planned.enhancedPrompt;

    let targetProvider = planned.plannedProvider;
    let targetModel = planned.plannedModel;

    try {
      logger.info({ provider: targetProvider, model: targetModel, prompt: enhancedPrompt }, "Executing image generation via primary provider");
      const execution = await aiProviderGatewayService.generateImage(targetProvider as any, {
        model: targetModel,
        prompt: enhancedPrompt,
        width,
        height,
        metadata: { originalPrompt: request.prompt },
      });

      const res = execution.result;
      return {
        buffer: res.buffer,
        enhancedPrompt,
        actualProvider: targetProvider,
        actualModel: res.model || targetModel,
        route: res.route,
        sourceUrl: res.sourceUrl,
        width,
        height,
        mimeType: res.mimeType || "image/png",
        failovers,
      };
    } catch (primaryErr: any) {
      const errMsg = primaryErr?.message || String(primaryErr);
      const httpStatus = primaryErr?.status || primaryErr?.statusCode;
      
      const errorCategory = errMsg.includes("401") || errMsg.includes("auth") || errMsg.includes("API key")
        ? "auth_error"
        : errMsg.includes("429") || errMsg.includes("rate")
        ? "rate_limit"
        : errMsg.includes("timeout")
        ? "timeout"
        : errMsg.includes("404") || errMsg.includes("not found")
        ? "model_unavailable"
        : "unknown";

      logger.warn({ primaryProvider: targetProvider, primaryModel: targetModel, error: errMsg }, "Primary image provider failed; executing capability failover");

      const failoverRecord: FailoverRecord = {
        primaryProvider: targetProvider,
        primaryModel: targetModel,
        errorCategory,
        errorMessage: errMsg,
        httpStatus,
        retryAttempt: 1,
        fallbackProvider: "community",
        fallbackModel: "flux-realism-community",
        fallbackType: "secondary_provider",
        timestamp: new Date().toISOString(),
      };
      failovers.push(failoverRecord);

      // Execute explicitly declared fallback provider
      const fallbackExecution = await aiProviderGatewayService.generateImage("huggingface" as any, {
        model: "flux-realism-community",
        prompt: enhancedPrompt,
        width,
        height,
        metadata: { originalPrompt: request.prompt, fallback: true, primaryError: errMsg },
      });

      const fallbackRes = fallbackExecution.result;
      return {
        buffer: fallbackRes.buffer,
        enhancedPrompt,
        actualProvider: "community",
        actualModel: fallbackRes.model || "flux-realism-community",
        route: "community",
        sourceUrl: fallbackRes.sourceUrl,
        width,
        height,
        mimeType: fallbackRes.mimeType || "image/png",
        failovers,
      };
    }
  }
}
