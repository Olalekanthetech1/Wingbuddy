import { logger } from "../lib/logger";
import type { GeminiService } from "../gemini/gemini.service";
import { aiProviderGatewayService } from "./ai-provider-gateway.service";
import { cloudinaryMediaStorageService } from "./cloudinary-media-storage.service";
import { mediaArtifactContextService } from "./media-artifact-context.service";
import { unifiedModelRegistryService } from "./unified-model-registry.service";
import type { AIProviderId } from "./ai-provider.types";

export interface GeneratedImageResult {
  buffer: Buffer; url: string; originalPrompt: string; enhancedPrompt: string;
  provider?: AIProviderId | "community"; route?: "inference_provider" | "community"; model?: string; fallbackUsed?: boolean;
  storageProvider?: "cloudinary" | "source"; cloudinaryPublicId?: string;
}

export class ImageGenerationService {
  static async enhancePrompt(rawPrompt: string, geminiService?: GeminiService): Promise<string> {
    const cleaned = rawPrompt.trim();
    if (!geminiService || cleaned.length > 280) return cleaned;
    try {
      const systemInstruction = "You are an expert prompt engineer for modern text-to-image models. Expand the user's idea into a single, visually striking, highly descriptive prompt detailing subjects, lighting, artistic style, composition, colors, and camera angle. Output ONLY the final image generation prompt in English. No explanations, no preamble, no quotes, no markdown formatting.";
      const timeoutPromise = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Prompt enhancement timeout")), 4000));
      const enhancePromise = geminiService.generateReply([], `Expand this idea into a vivid image generation prompt: "${cleaned}"`, { modeInstruction: systemInstruction }, { thinkingLevel: undefined, enableSearch: false });
      const enhanced = await Promise.race([enhancePromise, timeoutPromise]);
      const result = enhanced.replace(/^[“"']+|[”"']+$/g, "").replace(/^Prompt:\s*/i, "").trim();
      return result.length > 10 ? result : cleaned;
    } catch (err) { logger.warn({ err, originalPrompt: cleaned }, "Prompt enhancement failed or timed out; falling back to original prompt"); return cleaned; }
  }

  static async generate(rawPrompt: string, geminiService?: GeminiService, options: { width?: number; height?: number } = {}): Promise<GeneratedImageResult> {
    const originalPrompt = rawPrompt.trim();
    const enhancedPrompt = await this.enhancePrompt(originalPrompt, geminiService);
    const width = options.width || 1024;
    const height = options.height || 1024;
    const registered = await unifiedModelRegistryService.listByCapability("image_generation");
    const ordered = [...registered]
      .sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider) || a.modelId.localeCompare(b.modelId))
      .map((m) => ({ provider: m.provider, model: m.modelId, priority: m.priority }));
    if (!ordered.length) throw new Error("No enabled image-generation model is registered in the Dashboard model registry");

    let lastError: unknown;
    for (const candidate of ordered) {
      try {
        logger.info({ provider: candidate.provider, model: candidate.model, width, height }, "Generating image through Dashboard-registered adaptive media model");
        const execution = await aiProviderGatewayService.generateImage(candidate.provider, { model: candidate.model, prompt: enhancedPrompt, width, height, metadata: { originalPrompt } });
        const result = execution.result;
        const provider = result.route === "community" ? "community" : result.provider;
        let deliveryUrl = result.sourceUrl || `${result.provider}://image/${encodeURIComponent(result.model)}`;
        let storageProvider: GeneratedImageResult["storageProvider"] = "source";
        let cloudinaryPublicId: string | undefined;
        if (cloudinaryMediaStorageService.isConfigured()) {
          try { const uploaded = await cloudinaryMediaStorageService.uploadGeneratedMedia(result.buffer, { resourceType: "image", mimeType: result.mimeType }); deliveryUrl = uploaded.secureUrl; storageProvider = "cloudinary"; cloudinaryPublicId = uploaded.publicId; }
          catch (error) { logger.warn({ error: String(error), provider: result.provider, model: result.model }, "Cloudinary image storage failed; retaining generation source"); }
        }
        mediaArtifactContextService.remember({ type: "image", prompt: originalPrompt, publicUrl: deliveryUrl, provider, storageProvider, publicId: cloudinaryPublicId, model: result.model });
        return { buffer: result.buffer, url: deliveryUrl, originalPrompt, enhancedPrompt, provider, route: result.route, model: result.model, fallbackUsed: result.fallbackUsed, storageProvider, cloudinaryPublicId };
      } catch (error) { lastError = error; logger.warn({ provider: candidate.provider, model: candidate.model, error: String(error) }, "Adaptive image model attempt failed; trying next registered candidate"); }
    }
    throw new Error(`Image generation failed after ${ordered.length} registered adaptive model attempts. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  static extractImagePrompt(rawText: string): string {
    return rawText.replace(/^\/(image|draw|img|generate_image|paint)\s*/i, "").replace(/^(please\s+)?(can you\s+)?(generate|create|draw|paint|render|make|produce|visualize)\s+(me\s+)?(an?\s+)?(image|picture|photo|illustration|drawing|portrait|wallpaper|painting|artwork)\s+(of|about|showing|depicting)?\s*/i, "").replace(/^(draw|paint|illustrate|sketch)\s+(me\s+)?/i, "").trim();
  }
}
