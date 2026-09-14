import { unifiedModelRegistryService } from "./unified-model-registry.service";
import { logger } from "../lib/logger";
import type { GeminiService } from "../gemini/gemini.service";
import { adaptiveAIRouterService } from "./adaptive-ai-router.service";
import { aiProviderGatewayService } from "./ai-provider-gateway.service";
import { cloudinaryMediaStorageService } from "./cloudinary-media-storage.service";
import { huggingFaceCapabilityService } from "./huggingface-capability.service";
import { mediaArtifactContextService } from "./media-artifact-context.service";
import { ElevenLabsSoundService } from "./elevenlabs-sound.service";

export interface VideoPromptEnhancementResult {
  prompt: string;
  enhancerName?: string;
}

export interface GeneratedVideoResult {
  buffer: Buffer;
  url: string;
  originalPrompt: string;
  enhancedPrompt: string;
  enhancerName?: string;
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

function isPublicHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

export class VideoGenerationService {
  static async enhanceVideoPrompt(rawPrompt: string, geminiService?: GeminiService): Promise<VideoPromptEnhancementResult> {
    const cleaned = rawPrompt.trim();
    if (cleaned.length > 280) return { prompt: cleaned };

    const systemInstruction = "You are an expert director and prompt engineer for modern AI video generation models. Expand the user's prompt into a single descriptive video prompt specifying subject, cinematic camera movement, motion dynamics, atmosphere, and lighting. Output ONLY the final video prompt in English. Maximum 50 words. No explanations, no quotes, no markdown.";
    const promptRequest = `Expand this idea into a cinematic video generation prompt: "${cleaned}"`;

    // 1. Primary path: Unified model registry & adaptive router (routes across Groq, Mistral, Gemini, etc.)
    try {
      const routedPromise = adaptiveAIRouterService.route({
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: promptRequest },
        ],
        temperature: 0.7,
        maxTokens: 120,
      }, { mode: "video_prompt_enhancement" });

      const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Adaptive router video prompt enhancement timeout")), 4500));
      const routed = await Promise.race([routedPromise, timeoutPromise]);
      const text = routed.response.text || "";
      const result = text.replace(/^[“"']+|[”"']+$/g, "").replace(/^Prompt:\s*/i, "").trim();
      if (result.length > 10) {
        const enhancerName = routed.candidate.model.name || routed.candidate.model.modelId || routed.candidate.model.provider;
        logger.info({ originalPrompt: cleaned, enhancedPrompt: result, enhancerName, provider: routed.candidate.model.provider }, "Video prompt enhanced via unified registry routing");
        return { prompt: result, enhancerName };
      }
    } catch (routeErr) {
      logger.warn({ routeErr: routeErr instanceof Error ? routeErr.message : String(routeErr), originalPrompt: cleaned }, "Adaptive router video prompt enhancement failed; falling back if available");
    }

    // 2. Secondary fallback: direct Gemini service if provided
    if (geminiService) {
      try {
        const enhancePromise = geminiService.generateReply([], promptRequest, { modeInstruction: systemInstruction }, { thinkingLevel: undefined, enableSearch: false });
        const timeoutPromise = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Direct Gemini video prompt enhancement timeout")), 4000));
        const enhanced = await Promise.race([enhancePromise, timeoutPromise]);
        const result = enhanced.replace(/^[“"']+|[”"']+$/g, "").replace(/^Prompt:\s*/i, "").trim();
        if (result.length > 10) {
          logger.info({ originalPrompt: cleaned, enhancedPrompt: result }, "Video prompt enhanced via secondary Gemini fallback");
          return { prompt: result, enhancerName: "Google Gemini" };
        }
      } catch (geminiErr) {
        logger.warn({ geminiErr: geminiErr instanceof Error ? geminiErr.message : String(geminiErr), originalPrompt: cleaned }, "Direct Gemini video prompt enhancement fallback failed");
      }
    }

    return { prompt: cleaned };
  }

  static async generate(rawPrompt: string, geminiService?: GeminiService): Promise<GeneratedVideoResult> {
    const originalPrompt = rawPrompt.trim();
    const enhancement = await this.enhanceVideoPrompt(originalPrompt, geminiService);
    const enhancedPrompt = enhancement.prompt;
    const enhancerName = enhancement.enhancerName;
    const preferredModel = process.env.HF_VIDEO_MODEL?.trim() || undefined;
    const allModels = await unifiedModelRegistryService.list();
    const primaryVideo = allModels.find(m => m.enabled && m.roles.includes("primary_video")) 
      || allModels.find(m => m.enabled && m.capabilities.includes("video_generation") && m.provider !== "huggingface")
      || allModels.find(m => m.enabled && m.modelId.toLowerCase().includes("veo"));
    
    // Assemble candidate pool with primary engine first, then Hugging Face candidates
    const candidates: Array<{ provider: string; model: string; discovery: boolean; preferredAvailable: boolean }> = [];
    if (primaryVideo) {
      candidates.push({
        provider: primaryVideo.provider,
        model: primaryVideo.modelId,
        discovery: false,
        preferredAvailable: true,
      });
    }

    try {
      const capability = await huggingFaceCapabilityService.resolveModel("text-to-video", preferredModel);
      if (capability.model && !candidates.some(c => c.provider === "huggingface" && c.model === capability.model)) {
        candidates.push({
          provider: "huggingface",
          model: capability.model,
          discovery: capability.discovered,
          preferredAvailable: capability.preferredAvailable,
        });
      }
      for (const candidate of capability.candidates) {
        if (candidate.id && !candidates.some(c => c.provider === "huggingface" && c.model === candidate.id)) {
          candidates.push({
            provider: "huggingface",
            model: candidate.id,
            discovery: capability.discovered,
            preferredAvailable: false,
          });
        }
      }
    } catch (capErr) {
      logger.warn({ error: String(capErr) }, "Failed resolving Hugging Face video fallback candidates");
    }

    if (!candidates.length) throw new Error("No live video generation diffusion engines are available");

    let lastError: unknown;
    const maxCandidateTries = Math.min(candidates.length, 4);

    for (let i = 0; i < maxCandidateTries; i++) {
      const candidate = candidates[i];
      const maxRetries = 2;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          logger.info({
            originalPrompt,
            enhancedPrompt,
            provider: candidate.provider,
            model: candidate.model,
            attempt,
            maxRetries,
            discovered: candidate.discovery,
            preferredAvailable: candidate.preferredAvailable,
          }, "Generating video through adaptive model selection with retry & backoff");

          const execution = await aiProviderGatewayService.generateVideo(candidate.provider as any, {
            model: candidate.model,
            prompt: enhancedPrompt,
            metadata: { originalPrompt, capabilityDiscovery: candidate.discovery, preferredModelAvailable: candidate.preferredAvailable },
          });

          const result = execution.result;
          if (result.fallbackUsed || result.route === "community") {
            throw new Error("Synthetic motion fallback rejected; only authentic video diffusion is permitted");
          }
          const media = detectMediaType(result.buffer);
          if (!media.isVideo) throw new Error(`Model ${candidate.model} returned a non-video payload (${media.mimeType})`);

          let finalBuffer = result.buffer;
          try {
            finalBuffer = await ElevenLabsSoundService.attachAudioToVideo(result.buffer, originalPrompt);
          } catch (soundErr) {
            logger.warn({ error: String(soundErr) }, "ElevenLabs audio multiplexing failed; using video stream without sound");
          }

          const provider = result.provider || candidate.provider;
          let deliveryUrl = result.sourceUrl || `video://${encodeURIComponent(result.model)}`;
          let storageProvider: GeneratedVideoResult["storageProvider"] = "source";
          let cloudinaryPublicId: string | undefined;

          if (cloudinaryMediaStorageService.isConfigured()) {
            try {
              const uploaded = await cloudinaryMediaStorageService.uploadGeneratedMedia(finalBuffer, {
                resourceType: "video",
                mimeType: media.mimeType,
              });
              if (isPublicHttpsUrl(uploaded.secureUrl)) {
                deliveryUrl = uploaded.secureUrl;
                storageProvider = "cloudinary";
                cloudinaryPublicId = uploaded.publicId;
              }
            } catch (cloudErr) {
              logger.warn({ error: String(cloudErr), model: result.model }, "Cloudinary video storage failed; retaining generation source delivery");
            }
          }

          mediaArtifactContextService.remember({
            type: "video",
            prompt: originalPrompt,
            publicUrl: deliveryUrl,
            provider,
            storageProvider,
            publicId: cloudinaryPublicId,
            model: result.model,
          });

          logger.info({ model: candidate.model, provider, storageProvider, cloudinaryPublicId, publicUrl: deliveryUrl, attempt }, "Adaptive video generation and persistence succeeded");

          return {
            buffer: finalBuffer,
            url: deliveryUrl,
            originalPrompt,
            enhancedPrompt,
            enhancerName,
            provider,
            route: result.route,
            model: result.model,
            fallbackUsed: result.fallbackUsed,
            isVideo: true,
            mimeType: media.mimeType,
            storageProvider,
            cloudinaryPublicId,
          };
        } catch (error) {
          lastError = error;
          const isTransient = String(error).includes("429") || String(error).includes("503") || String(error).includes("timeout") || String(error).includes("rate");
          logger.warn({
            provider: candidate.provider,
            model: candidate.model,
            attempt,
            isTransient,
            error: String(error),
          }, "Video diffusion candidate attempt failed");

          if (attempt < maxRetries && isTransient) {
            const backoffMs = attempt * 1500;
            logger.info({ backoffMs, model: candidate.model }, "Applying exponential backoff before video retry");
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          }
        }
      }
    }

    throw new Error(`Generative video diffusion engines are currently experiencing high demand or transient provider rate limits after ${maxCandidateTries} attempts. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  static extractVideoPrompt(rawText: string): string {
    return rawText
      .replace(/^\/(video|vid|clip|generate_video|movie)\s*/i, "")
      .replace(/^(please\s+)?(can you\s+)?(generate|create|render|make|produce)\s+(me\s+)?(an?\s+)?(video|clip|animation|short film|movie)\s+(of|about|showing|depicting)?\s*/i, "")
      .trim();
  }
}