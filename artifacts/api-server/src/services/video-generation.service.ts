import { logger } from "../lib/logger";
import type { GeminiService } from "../gemini/gemini.service";
import { aiProviderGatewayService } from "./ai-provider-gateway.service";
import { cloudinaryMediaStorageService } from "./cloudinary-media-storage.service";
import { mediaArtifactContextService } from "./media-artifact-context.service";
import { unifiedModelRegistryService } from "./unified-model-registry.service";
import type { AIProviderId } from "./ai-provider.types";

export interface GeneratedVideoResult { buffer: Buffer; url: string; originalPrompt: string; enhancedPrompt: string; provider: AIProviderId; route?: "inference_provider"; model?: string; fallbackUsed?: boolean; isVideo: boolean; mimeType: string; storageProvider?: "cloudinary" | "source"; cloudinaryPublicId?: string; }
function detectMediaType(buffer: Buffer): { isVideo: boolean; mimeType: string } { if (buffer.length >= 8 && buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) return { isVideo: true, mimeType: "video/mp4" }; if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return { isVideo: true, mimeType: "video/webm" }; return { isVideo: false, mimeType: "application/octet-stream" }; }
function isPublicHttpsUrl(value: unknown): value is string { if (typeof value !== "string" || !value.trim()) return false; try { return new URL(value).protocol === "https:"; } catch { return false; } }

export class VideoGenerationService {
  static async enhanceVideoPrompt(rawPrompt: string, geminiService?: GeminiService): Promise<string> { const cleaned = rawPrompt.trim(); if (!geminiService || cleaned.length > 280) return cleaned; try { const systemInstruction = "You are an expert director and prompt engineer for modern AI video generation models. Expand the user's prompt into a single descriptive video prompt specifying subject, cinematic camera movement, motion dynamics, atmosphere, and lighting. Output ONLY the final video prompt in English. Maximum 50 words. No explanations, no quotes, no markdown."; const timeoutPromise = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Video prompt enhancement timeout")), 4000)); const enhancePromise = geminiService.generateReply([], `Expand this idea into a cinematic video generation prompt: "${cleaned}"`, { modeInstruction: systemInstruction }, { thinkingLevel: undefined, enableSearch: false }); const enhanced = await Promise.race([enhancePromise, timeoutPromise]); const result = enhanced.replace(/^[“"']+|[”"']+$/g, "").replace(/^Prompt:\s*/i, "").trim(); return result.length > 10 ? result : cleaned; } catch (err) { logger.warn({ err, originalPrompt: cleaned }, "Video prompt enhancement failed or timed out; falling back to original prompt"); return cleaned; } }

  static async generate(rawPrompt: string, geminiService?: GeminiService): Promise<GeneratedVideoResult> {
    const originalPrompt = rawPrompt.trim(); const enhancedPrompt = await this.enhanceVideoPrompt(originalPrompt, geminiService);
    const registered = await unifiedModelRegistryService.listByCapability("video_generation");
    const ordered = [...registered]
      .sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider) || a.modelId.localeCompare(b.modelId))
      .map((m) => ({ provider: m.provider, model: m.modelId, priority: m.priority }));
    if (!ordered.length) throw new Error("No enabled video-generation model is registered in the Dashboard model registry");

    let lastError: unknown;
    for (const candidate of ordered) {
      try {
        logger.info({ provider: candidate.provider, model: candidate.model }, "Generating video through Dashboard-registered adaptive media model");
        const execution = await aiProviderGatewayService.generateVideo(candidate.provider, { model: candidate.model, prompt: enhancedPrompt, metadata: { originalPrompt } });
        const result = execution.result; const media = detectMediaType(result.buffer); if (!media.isVideo) throw new Error(`${candidate.provider}/${candidate.model} returned a non-video payload`);
        if (!cloudinaryMediaStorageService.isConfigured()) throw new Error("Cloudinary is required to persist generated videos as public artifacts");
        const uploaded = await cloudinaryMediaStorageService.uploadGeneratedMedia(result.buffer, { resourceType: "video", mimeType: media.mimeType }); if (!isPublicHttpsUrl(uploaded.secureUrl)) throw new Error("Cloudinary returned an invalid public video URL");
        mediaArtifactContextService.remember({ type: "video", prompt: originalPrompt, publicUrl: uploaded.secureUrl, provider: result.provider, storageProvider: "cloudinary", publicId: uploaded.publicId, model: result.model });
        return { buffer: result.buffer, url: uploaded.secureUrl, originalPrompt, enhancedPrompt, provider: result.provider, route: result.route, model: result.model, fallbackUsed: result.fallbackUsed, isVideo: true, mimeType: media.mimeType, storageProvider: "cloudinary", cloudinaryPublicId: uploaded.publicId };
      } catch (error) { lastError = error; logger.warn({ provider: candidate.provider, model: candidate.model, error: String(error) }, "Adaptive video model attempt failed; trying next registered candidate"); }
    }
    throw new Error(`Video generation failed after ${ordered.length} registered adaptive model attempts. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  static extractVideoPrompt(rawText: string): string { return rawText.replace(/^\/(video|vid|clip|generate_video|movie)\s*/i, "").replace(/^(please\s+)?(can you\s+)?(generate|create|render|make|produce)\s+(me\s+)?(an?\s+)?(video|clip|animation|short film|movie)\s+(of|about|showing|depicting)?\s*/i, "").trim(); }
}
