import { logger } from "../lib/logger";
import type { GeminiService } from "../gemini/gemini.service";
import { aiProviderGatewayService } from "./ai-provider-gateway.service";
import { cloudinaryMediaStorageService } from "./cloudinary-media-storage.service";
import { huggingFaceCapabilityService } from "./huggingface-capability.service";
import { mediaArtifactContextService } from "./media-artifact-context.service";

export interface GeneratedVideoResult {
  buffer: Buffer;
  url: string;
  originalPrompt: string;
  enhancedPrompt: string;
  provider: "huggingface";
  route?: "inference_provider";
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
  return { isVideo: false, mimeType: "application/octet-stream" };
}

function isPublicHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

export class VideoGenerationService {
  static async enhanceVideoPrompt(rawPrompt: string, geminiService?: GeminiService): Promise<string> {
    const cleaned = rawPrompt.trim();
    if (!geminiService || cleaned.length > 280) return cleaned;
    try {
      const systemInstruction = "You are an expert director and prompt engineer for modern AI video generation models. Expand the user's prompt into a single descriptive video prompt specifying subject, cinematic camera movement, motion dynamics, atmosphere, and lighting. Output ONLY the final video prompt in English. Maximum 50 words. No explanations, no quotes, no markdown.";
      const promptRequest = `Expand this idea into a cinematic video generation prompt: \"${cleaned}\"`;
      const timeoutPromise = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Video prompt enhancement timeout")), 4000));
      const enhancePromise = geminiService.generateReply([], promptRequest, { modeInstruction: systemInstruction }, { thinkingLevel: undefined, enableSearch: false });
      const enhanced = await Promise.race([enhancePromise, timeoutPromise]);
      const result = enhanced.replace(/^[“\"']+|[”\"']+$/g, "").replace(/^Prompt:\s*/i, "").trim();
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

    const discoveredModels = capability.candidates.map((candidate) => candidate.id).filter(Boolean);
    const orderedModels = [
      capability.model,
      ...discoveredModels,
    ].filter((model, index, all) => Boolean(model) && all.indexOf(model) === index).slice(0, 6);

    if (!orderedModels.length) throw new Error("No live Hugging Face text-to-video model is available");

    let lastError: unknown;
    for (const model of orderedModels) {
      try {
        logger.info({ originalPrompt, enhancedPrompt, model, discovered: capability.discovered, preferredAvailable: capability.preferredAvailable }, "Generating video through adaptive Hugging Face model selection");
        const execution = await aiProviderGatewayService.generateVideo("huggingface", {
          model,
          prompt: enhancedPrompt,
          metadata: { originalPrompt, capabilityDiscovery: capability.discovered, preferredModelAvailable: capability.preferredAvailable },
        });
        const result = execution.result;
        const media = detectMediaType(result.buffer);
        if (!media.isVideo) throw new Error(`Hugging Face model ${model} returned a non-video payload (${media.mimeType})`);

        if (!cloudinaryMediaStorageService.isConfigured()) {
          throw new Error("Cloudinary is required to persist generated videos as public artifacts");
        }
        const uploaded = await cloudinaryMediaStorageService.uploadGeneratedMedia(result.buffer, {
          resourceType: "video",
          mimeType: media.mimeType,
        });
        if (!isPublicHttpsUrl(uploaded.secureUrl)) throw new Error("Cloudinary returned an invalid public video URL");

        mediaArtifactContextService.remember({
          type: "video",
          prompt: originalPrompt,
          publicUrl: uploaded.secureUrl,
          provider: "huggingface",
          storageProvider: "cloudinary",
          publicId: uploaded.publicId,
          model: result.model,
        });

        logger.info({ model, provider: result.provider, storageProvider: "cloudinary", cloudinaryPublicId: uploaded.publicId, publicUrl: uploaded.secureUrl }, "Adaptive video generation and persistence succeeded");
        return {
          buffer: result.buffer,
          url: uploaded.secureUrl,
          originalPrompt,
          enhancedPrompt,
          provider: "huggingface",
          route: result.route,
          model: result.model,
          fallbackUsed: result.fallbackUsed,
          isVideo: true,
          mimeType: media.mimeType,
          storageProvider: "cloudinary",
          cloudinaryPublicId: uploaded.publicId,
        };
      } catch (error) {
        lastError = error;
        logger.warn({ model, error: String(error) }, "Adaptive Hugging Face video model attempt failed; trying next discovered candidate");
      }
    }

    throw new Error(`Hugging Face video generation failed after ${orderedModels.length} adaptive model attempts. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  static extractVideoPrompt(rawText: string): string {
    return rawText
      .replace(/^\/(video|vid|clip|generate_video|movie)\s*/i, "")
      .replace(/^(please\s+)?(can you\s+)?(generate|create|render|make|produce)\s+(me\s+)?(an?\s+)?(video|clip|animation|short film|movie)\s+(of|about|showing|depicting)?\s*/i, "")
      .trim();
  }
}
