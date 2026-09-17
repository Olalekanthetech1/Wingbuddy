import { unifiedModelRegistryService } from "./unified-model-registry.service";
import { logger } from "../lib/logger";
import type { GeminiService } from "../gemini/gemini.service";
import { adaptiveAIRouterService } from "./adaptive-ai-router.service";
import { aiProviderGatewayService } from "./ai-provider-gateway.service";
import { cloudinaryMediaStorageService } from "./cloudinary-media-storage.service";
import { huggingFaceCapabilityService } from "./huggingface-capability.service";
import { mediaArtifactContextService } from "./media-artifact-context.service";

export interface PromptEnhancementResult {
  prompt: string;
  enhancerName?: string;
}

export interface GeneratedImageResult {
  buffer: Buffer;
  url: string;
  originalPrompt: string;
  enhancedPrompt: string;
  enhancerName?: string;
  provider?: "huggingface" | "community";
  route?: "inference_provider" | "community";
  model?: string;
  fallbackUsed?: boolean;
  storageProvider?: "cloudinary" | "source";
  cloudinaryPublicId?: string;
}

export class ImageGenerationService {
  static async enhancePrompt(rawPrompt: string, _geminiService?: GeminiService): Promise<PromptEnhancementResult> {
    // Fast-path: Send user prompt directly to the image generation model without 4-8 second LLM expansion
    const cleaned = rawPrompt.trim();
    return { prompt: cleaned };
  }

  static async generate(rawPrompt: string, geminiService?: GeminiService, options: { width?: number; height?: number } = {}): Promise<GeneratedImageResult> {
    const originalPrompt = rawPrompt.trim();
    const enhancement = await this.enhancePrompt(originalPrompt, geminiService);
    const enhancedPrompt = enhancement.prompt;
    const enhancerName = enhancement.enhancerName;
    const width = options.width || 1024;
    const height = options.height || 1024;
    
    const allModels = await unifiedModelRegistryService.list();
    const primaryImage = allModels.find(m => m.enabled && m.roles.includes("primary_image"));
    let finalProvider = "huggingface";
    let finalModel = "";
    let discovery = false;
    let preferredAvail = false;

    if (primaryImage) {
      finalProvider = primaryImage.provider;
      finalModel = primaryImage.modelId;
      preferredAvail = true;
    } else {
      const preferredModel = process.env.HF_IMAGE_MODEL?.trim() || undefined;
      const capability = await huggingFaceCapabilityService.resolveModel("text-to-image", preferredModel);
      finalModel = capability.model;
      discovery = capability.discovered;
      preferredAvail = capability.preferredAvailable;
    }

    logger.info({ originalPrompt, enhancedPrompt, enhancerName, width, height, model: finalModel, discovered: discovery, preferredAvailable: preferredAvail }, "Generating image through dynamically selected capability");
    const execution = await aiProviderGatewayService.generateImage(finalProvider as any, {
      model: finalModel,
      prompt: enhancedPrompt,
      width,
      height,
      metadata: { originalPrompt, capabilityDiscovery: discovery, preferredModelAvailable: preferredAvail },
    });
    const result = execution.result;
    const provider = result.route === "community" ? "community" : "huggingface";

    let deliveryUrl = result.sourceUrl || `huggingface://image/${encodeURIComponent(result.model)}`;
    let storageProvider: GeneratedImageResult["storageProvider"] = "source";
    let cloudinaryPublicId: string | undefined;

    if (cloudinaryMediaStorageService.isConfigured()) {
      try {
        const uploaded = await cloudinaryMediaStorageService.uploadGeneratedMedia(result.buffer, {
          resourceType: "image",
          mimeType: "image/png",
        });
        deliveryUrl = uploaded.secureUrl;
        storageProvider = "cloudinary";
        cloudinaryPublicId = uploaded.publicId;
      } catch (error) {
        logger.warn({ error: String(error), model: result.model }, "Cloudinary image storage failed; retaining generation source");
      }
    }

    mediaArtifactContextService.remember({
      type: "image",
      prompt: originalPrompt,
      publicUrl: deliveryUrl,
      provider,
      storageProvider,
      publicId: cloudinaryPublicId,
      model: result.model,
    });

    return {
      buffer: result.buffer,
      url: deliveryUrl,
      originalPrompt,
      enhancedPrompt,
      enhancerName,
      provider,
      route: result.route,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
      storageProvider,
      cloudinaryPublicId,
    };
  }

  static extractImagePrompt(rawText: string): string {
    return rawText
      .replace(/^\/(image|draw|img|generate_image|paint)\s*/i, "")
      .replace(/^(please\s+)?(can you\s+)?(generate|create|draw|paint|render|make|produce|visualize)\s+(me\s+)?(an?\s+)?(image|picture|photo|illustration|drawing|portrait|wallpaper|painting|artwork)\s+(of|about|showing|depicting)?\s*/i, "")
      .replace(/^(draw|paint|illustrate|sketch)\s+(me\s+)?/i, "")
      .trim();
  }
}
