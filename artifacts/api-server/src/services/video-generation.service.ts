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
    const primaryVideo = allModels.find(m => m.enabled && m.roles.includes("primary_video"));
    
    let targetProvider = "huggingface";
    let targetModel = "";
    let orderedModels: string[] = [];
    let discovery = false;
    let preferredAvail = false;

    if (primaryVideo) {
      targetProvider = primaryVideo.provider;
      targetModel = primaryVideo.modelId;
      orderedModels = [targetModel];
      preferredAvail = true;
    } else {
      const capability = await huggingFaceCapabilityService.resolveModel("text-to-video", preferredModel);
      discovery = capability.discovered;
      preferredAvail = capability.preferredAvailable;
      
      const discoveredModels = capability.candidates.map((candidate) => candidate.id).filter(Boolean);
      orderedModels = [
        capability.model,
        ...discoveredModels,
      ].filter((model, index, all) => Boolean(model) && all.indexOf(model) === index).slice(0, 6);
    }

    if (!orderedModels.length) throw new Error("No live Hugging Face text-to-video model is available");
    let lastError: unknown;
    for (const model of orderedModels) {
      try {
        logger.info({ originalPrompt, enhancedPrompt, model, discovered: discovery, preferredAvailable: preferredAvail }, "Generating video through adaptive model selection");
        const execution = await aiProviderGatewayService.generateVideo(targetProvider as any, {
          model,
          prompt: enhancedPrompt,
          metadata: { originalPrompt, capabilityDiscovery: discovery, preferredModelAvailable: preferredAvail },
        });
        const result = execution.result;
        const media = detectMediaType(result.buffer);
        if (!media.isVideo) throw new Error(`Hugging Face model ${model} returned a non-video payload (${media.mimeType})`);

        let finalBuffer = result.buffer;
        try {
          finalBuffer = await ElevenLabsSoundService.attachAudioToVideo(result.buffer, originalPrompt);
        } catch (soundErr) {
          logger.warn({ error: String(soundErr) }, "ElevenLabs audio multiplexing failed; using video stream without sound");
        }

        const provider = result.route === "community" || result.provider === "community" ? "community" : "huggingface";
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

        logger.info({ model, provider, storageProvider, cloudinaryPublicId, publicUrl: deliveryUrl, fallbackUsed: result.fallbackUsed }, "Adaptive video generation and persistence succeeded");

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