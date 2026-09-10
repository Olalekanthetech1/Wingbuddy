import { logger } from "../lib/logger";
import type { GeminiService } from "../gemini/gemini.service";
import { aiProviderGatewayService } from "./ai-provider-gateway.service";
import { cloudinaryMediaStorageService } from "./cloudinary-media-storage.service";
import { huggingFaceCapabilityService } from "./huggingface-capability.service";

export interface GeneratedVideoResult {
  buffer: Buffer;
  url: string;
  originalPrompt: string;
  enhancedPrompt: string;
  provider: "huggingface" | "community";
  route?: "inference_provider" | "community";
  model?: string;
  fallbackUsed?: boolean;
  isVideo: boolean;
  mimeType: string;
  storageProvider?: "cloudinary" | "source";
  cloudinaryPublicId?: string;
}

function detectMediaType(buffer: Buffer): { isVideo: boolean; mimeType: string } {
  if (buffer.length >= 8) {
    if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) return { isVideo: true, mimeType: "video/mp4" };
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return { isVideo: true, mimeType: "video/webm" };
  }
  return { isVideo: false, mimeType: "image/jpeg" };
}

export class VideoGenerationService {
  static async enhanceVideoPrompt(rawPrompt: string, geminiService?: GeminiService): Promise<string> {
    const cleaned = rawPrompt.trim();
    if (!geminiService || cleaned.length > 280) return cleaned;
    try {
      const systemInstruction = "You are an expert director and prompt engineer for modern AI video generation models. Expand the user's prompt into a single descriptive video prompt specifying subject, cinematic camera movement, motion dynamics, atmosphere, and lighting. Output ONLY the final video prompt in English. Maximum 50 words. No explanations, no quotes, no markdown.";
      const promptRequest = `Expand this idea into a cinematic video generation prompt: "${cleaned}"`;
      const timeoutPromise = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Video prompt enhancement timeout")), 4000));
      const enhancePromise = geminiService.generateReply([], promptRequest, { modeInstruction: systemInstruction }, { thinkingLevel: undefined, enableSearch: false });
      const enhanced = await Promise.race([enhancePromise, timeoutPromise]);
      const result = enhanced.replace(/^[“"']+|[”"']+$/g, "").replace(/^Prompt:\s*/i, "").trim();
      return result.length > 10 ? result : cleaned;
    } catch (err) {
      logger.warn({ err, originalPrompt: cleaned }, "Video prompt enhancement failed or timed out; falling back to original prompt");
      return cleaned;
    }
  }

  static async generate(rawPrompt: string, geminiService?: GeminiService): Promise<GeneratedVideoResult> {
    const originalPrompt = rawPrompt.trim();
    const enhancedPrompt = await this.enhanceVideoPrompt(originalPrompt, geminiService);
    const preferredModel = process.env.HF_VIDEO_MODEL?.trim() || undefined;
    const capability = await huggingFaceCapabilityService.resolveModel("text-to-video", preferredModel);

    logger.info({ originalPrompt, enhancedPrompt, model: capability.model, discovered: capability.discovered, preferredAvailable: capability.preferredAvailable }, "Generating video through dynamically selected Hugging Face capability");
    const execution = await aiProviderGatewayService.generateVideo("huggingface", {
      model: capability.model,
      prompt: enhancedPrompt,
      metadata: { originalPrompt, capabilityDiscovery: capability.discovered, preferredModelAvailable: capability.preferredAvailable },
    });
    const result = execution.result;
    const media = detectMediaType(result.buffer);
    const provider = result.route === "community" ? "community" : "huggingface";

    let deliveryUrl = result.sourceUrl || `huggingface://video/${encodeURIComponent(result.model)}`;
    let storageProvider: GeneratedVideoResult["storageProvider"] = "source";
    let cloudinaryPublicId: string | undefined;

    if (media.isVideo && cloudinaryMediaStorageService.isConfigured()) {
      try {
        const uploaded = await cloudinaryMediaStorageService.uploadGeneratedMedia(result.buffer, {
          resourceType: "video",
          mimeType: media.mimeType,
        });
        deliveryUrl = uploaded.secureUrl;
        storageProvider = "cloudinary";
        cloudinaryPublicId = uploaded.publicId;
      } catch (error) {
        logger.warn({ error: String(error), model: result.model }, "Cloudinary video storage failed; retaining generation source");
      }
    }

    return {
      buffer: result.buffer,
      url: deliveryUrl,
      originalPrompt,
      enhancedPrompt,
      provider,
      route: result.route,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
      isVideo: media.isVideo,
      mimeType: media.mimeType,
      storageProvider,
      cloudinaryPublicId,
    };
  }

  static extractVideoPrompt(rawText: string): string {
    return rawText
      .replace(/^\/(video|vid|clip|generate_video|movie)\s*/i, "")
      .replace(/^(please\s+)?(can you\s+)?(generate|create|render|make|produce)\s+(me\s+)?(an?\s+)?(video|clip|animation|short film|movie)\s+(of|about|showing|depicting)?\s*/i, "")
      .trim();
  }
}
