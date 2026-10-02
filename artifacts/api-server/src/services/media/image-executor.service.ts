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

function cleanExpandedImagePrompt(text: string, fallback: string): string {
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

export class ImageExecutor {
  static async enhancePrompt(rawPrompt: string): Promise<{ prompt: string; enhancerModel?: string }> {
    // Fast-path: Send user prompt directly to avoid expansion latency
    const cleaned = rawPrompt.trim();
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
      logger.error({ primaryProvider: targetProvider, primaryModel: targetModel, error: errMsg }, "Primary image generation failed; zero-fallback policy prevents hardcoded community failover.");
      
      // Strict Zero-Fallback: Throw authentic error instead of switching to a hardcoded 'community' model.
      throw new Error(`Media generation failed: ${errMsg}`);
    }
  }
}
