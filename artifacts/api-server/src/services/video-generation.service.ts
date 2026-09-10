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
  return { isVideo: false, mimeType: "application/octet-stream" };
}

function isPublicHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function normalizeBaseUrl(value: string): string { return value.replace(/\/+$/, ""); }

function communityApiKey(): string | undefined {
  return process.env.POLLINATIONS_API_KEY?.trim() || process.env.COMMUNITY_VIDEO_API_KEY?.trim() || undefined;
}

interface CommunityVideoModel {
  id: string;
  outputModalities?: string[];
  paidOnly?: boolean;
}

function parseCommunityVideoModels(payload: unknown): CommunityVideoModel[] {
  const rows = Array.isArray(payload) ? payload : (payload && typeof payload === "object" && Array.isArray((payload as any).data) ? (payload as any).data : []);
  return rows
    .map((row: any) => {
      const id = typeof row?.id === "string" ? row.id.trim() : "";
      const outputModalities = Array.isArray(row?.outputModalities)
        ? row.outputModalities.filter((value: unknown): value is string => typeof value === "string")
        : Array.isArray(row?.output_modalities)
          ? row.output_modalities.filter((value: unknown): value is string => typeof value === "string")
          : [];
      if (!id) return null;
      return { id, outputModalities, paidOnly: row?.paid_only === true || row?.paidOnly === true } satisfies CommunityVideoModel;
    })
    .filter((row): row is CommunityVideoModel => Boolean(row));
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

  private static async resolveCommunityVideoModel(apiKey: string): Promise<string> {
    const explicitlyConfigured = process.env.COMMUNITY_VIDEO_MODEL?.trim();
    const baseUrl = normalizeBaseUrl(process.env.POLLINATIONS_BASE_URL?.trim() || "https://gen.pollinations.ai");
    const response = await fetch(`${baseUrl}/image/models`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) throw new Error(`Community video model discovery failed (${response.status})`);
    const models = parseCommunityVideoModels(await response.json());
    const videoModels = models.filter((model) => model.outputModalities.some((value) => value.toLowerCase() === "video") && !model.paidOnly);
    if (explicitlyConfigured) {
      const match = models.find((model) => model.id === explicitlyConfigured && model.outputModalities.some((value) => value.toLowerCase() === "video"));
      if (!match) throw new Error(`Configured community video model '${explicitlyConfigured}' is not currently available for video generation`);
      return match.id;
    }
    const selected = videoModels[0];
    if (!selected) throw new Error("No currently available non-paid community video model was advertised by the provider");
    return selected.id;
  }

  private static async generateCommunityVideo(prompt: string): Promise<{ buffer: Buffer; model: string; sourceUrl: string; mimeType: string }> {
    const apiKey = communityApiKey();
    if (!apiKey) throw new Error("Community video fallback is not configured; set POLLINATIONS_API_KEY or COMMUNITY_VIDEO_API_KEY");

    const baseUrl = normalizeBaseUrl(process.env.POLLINATIONS_BASE_URL?.trim() || "https://gen.pollinations.ai");
    const model = await this.resolveCommunityVideoModel(apiKey);
    const durationRaw = Number(process.env.COMMUNITY_VIDEO_DURATION_SECONDS || 4);
    const duration = Number.isFinite(durationRaw) && durationRaw >= 1 ? Math.min(120, Math.floor(durationRaw)) : 4;
    const aspectRatio = /^\d+:\d+$/.test(process.env.COMMUNITY_VIDEO_ASPECT_RATIO?.trim() || "")
      ? process.env.COMMUNITY_VIDEO_ASPECT_RATIO!.trim()
      : "16:9";
    const url = new URL(`${baseUrl}/video/${encodeURIComponent(prompt.slice(0, 1800))}`);
    url.searchParams.set("model", model);
    url.searchParams.set("duration", String(duration));
    url.searchParams.set("aspectRatio", aspectRatio);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "video/mp4,video/webm,video/*", Authorization: `Bearer ${apiKey}`, "User-Agent": "Wingbuddy/3.0" },
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Community video endpoint returned HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ""}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const media = detectMediaType(buffer);
      if (!media.isVideo || buffer.length <= 2000) throw new Error("Community video endpoint returned an invalid video payload");
      logger.info({ model, route: "community", duration, aspectRatio }, "Community video generation succeeded");
      return { buffer, model, sourceUrl: url.toString(), mimeType: media.mimeType };
    } finally {
      clearTimeout(timer);
    }
  }

  static async generate(rawPrompt: string, geminiService?: GeminiService): Promise<GeneratedVideoResult> {
    const originalPrompt = rawPrompt.trim();
    const enhancedPrompt = await this.enhanceVideoPrompt(originalPrompt, geminiService);
    const preferredModel = process.env.HF_VIDEO_MODEL?.trim() || undefined;
    let capabilityError: unknown;
    let capability: Awaited<ReturnType<typeof huggingFaceCapabilityService.resolveModel>> | undefined;

    try {
      capability = await huggingFaceCapabilityService.resolveModel("text-to-video", preferredModel);
    } catch (error) {
      capabilityError = error;
      logger.warn({ error: String(error) }, "Hugging Face video capability discovery unavailable; proceeding to community fallback");
    }

    const discoveredModels = capability?.candidates.map((candidate) => candidate.id).filter(Boolean) || [];
    const orderedModels = [
      ...(capability?.model ? [capability.model] : []),
      ...discoveredModels,
    ].filter((model, index, all) => Boolean(model) && all.indexOf(model) === index).slice(0, 6);

    let lastError: unknown = capabilityError;
    for (const model of orderedModels) {
      try {
        logger.info({ originalPrompt, enhancedPrompt, model, discovered: capability?.discovered, preferredAvailable: capability?.preferredAvailable }, "Generating video through adaptive Hugging Face model selection");
        const execution = await aiProviderGatewayService.generateVideo("huggingface", {
          model,
          prompt: enhancedPrompt,
          metadata: { originalPrompt, capabilityDiscovery: capability?.discovered ?? false, preferredModelAvailable: capability?.preferredAvailable ?? false },
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
        logger.warn({ model, error: String(error) }, "Adaptive Hugging Face video model attempt failed; trying next candidate");
      }
    }

    try {
      const community = await this.generateCommunityVideo(enhancedPrompt);
      if (!cloudinaryMediaStorageService.isConfigured()) {
        throw new Error("Cloudinary is required to persist generated videos as public artifacts");
      }
      const uploaded = await cloudinaryMediaStorageService.uploadGeneratedMedia(community.buffer, {
        resourceType: "video",
        mimeType: community.mimeType,
      });
      if (!isPublicHttpsUrl(uploaded.secureUrl)) throw new Error("Cloudinary returned an invalid public community video URL");

      mediaArtifactContextService.remember({
        type: "video",
        prompt: originalPrompt,
        publicUrl: uploaded.secureUrl,
        provider: "community",
        storageProvider: "cloudinary",
        publicId: uploaded.publicId,
        model: community.model,
      });

      logger.info({ model: community.model, route: "community", storageProvider: "cloudinary", cloudinaryPublicId: uploaded.publicId, sourceUrl: community.sourceUrl }, "Community video fallback and persistence succeeded");
      return {
        buffer: community.buffer,
        url: uploaded.secureUrl,
        originalPrompt,
        enhancedPrompt,
        provider: "community",
        route: "community",
        model: community.model,
        fallbackUsed: true,
        isVideo: true,
        mimeType: community.mimeType,
        storageProvider: "cloudinary",
        cloudinaryPublicId: uploaded.publicId,
      };
    } catch (communityError) {
      lastError = communityError;
      logger.error({ error: String(communityError), previousHuggingFaceError: String(capabilityError || "none") }, "Community video fallback failed; returning an honest generation failure");
    }

    throw new Error(`Video generation failed. Hugging Face attempts: ${orderedModels.length}; community fallback: unavailable or failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  static extractVideoPrompt(rawText: string): string {
    return rawText
      .replace(/^\/(video|vid|clip|generate_video|movie)\s*/i, "")
      .replace(/^(please\s+)?(can you\s+)?(generate|create|render|make|produce)\s+(me\s+)?(an?\s+)?(video|clip|animation|short film|movie)\s+(of|about|showing|depicting)?\s*/i, "")
      .trim();
  }
}