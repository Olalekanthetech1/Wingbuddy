import { logger } from "../lib/logger";
import type { GeminiService } from "../gemini/gemini.service";

export interface GeneratedVideoResult {
  buffer: Buffer;
  url: string;
  originalPrompt: string;
  enhancedPrompt: string;
  provider: "huggingface" | "community";
  isVideo: boolean;
  mimeType: string;
}

function detectMediaType(buffer: Buffer): { isVideo: boolean; mimeType: string } {
  if (buffer.length >= 8) {
    // MP4 check (ftyp box at byte offset 4)
    if (
      buffer[4] === 0x66 &&
      buffer[5] === 0x74 &&
      buffer[6] === 0x79 &&
      buffer[7] === 0x70
    ) {
      return { isVideo: true, mimeType: "video/mp4" };
    }
    // WebM / Matroska check
    if (
      buffer[0] === 0x1a &&
      buffer[1] === 0x45 &&
      buffer[2] === 0xdf &&
      buffer[3] === 0xa3
    ) {
      return { isVideo: true, mimeType: "video/webm" };
    }
  }
  return { isVideo: false, mimeType: "image/jpeg" };
}

export class VideoGenerationService {
  /**
   * Enhances a user's prompt into a vivid, motion-aware video prompt
   * using Gemini Flash (including camera movements, motion dynamics, and pacing).
   */
  static async enhanceVideoPrompt(
    rawPrompt: string,
    geminiService?: GeminiService,
  ): Promise<string> {
    const cleaned = rawPrompt.trim();
    if (!geminiService || cleaned.length > 280) {
      return cleaned;
    }

    try {
      const systemInstruction =
        "You are an expert director and prompt engineer for AI video generation models (CogVideoX, ModelScope, Wan). " +
        "Expand the user's prompt into a single descriptive video prompt specifying subject, cinematic camera movement (e.g. slow pan, drone flythrough, tracking shot), motion dynamics, atmosphere, and lighting. " +
        "Output ONLY the final video prompt in English. Maximum 50 words. No explanations, no quotes, no markdown.";

      const promptRequest = `Expand this idea into a cinematic video generation prompt: "${cleaned}"`;

      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("Video prompt enhancement timeout")), 4000),
      );

      const enhancePromise = geminiService.generateReply(
        [],
        promptRequest,
        { modeInstruction: systemInstruction },
        { thinkingLevel: undefined, enableSearch: false },
      );

      const enhanced = await Promise.race([enhancePromise, timeoutPromise]);
      const result = enhanced
        .replace(/^[“"']+|[”"']+$/g, "")
        .replace(/^Prompt:\s*/i, "")
        .trim();

      return result.length > 10 ? result : cleaned;
    } catch (err) {
      logger.warn(
        { err, originalPrompt: cleaned },
        "Video prompt enhancement failed or timed out; falling back to original prompt",
      );
      return cleaned;
    }
  }

  /**
   * Generates a video using Hugging Face if HF_TOKEN is present,
   * otherwise seamlessly falls back to the Free Community video engine.
   */
  static async generate(
    rawPrompt: string,
    geminiService?: GeminiService,
  ): Promise<GeneratedVideoResult> {
    const originalPrompt = rawPrompt.trim();
    const hfToken = process.env.HF_TOKEN?.trim();

    // 1. Enhance the prompt with cinematic camera motion details
    const enhancedPrompt = await this.enhanceVideoPrompt(originalPrompt, geminiService);

    // 2. If HF_TOKEN is configured, try Hugging Face Serverless Inference
    if (hfToken) {
      try {
        logger.info({ originalPrompt, enhancedPrompt }, "Attempting video generation via Hugging Face");
        const hfResult = await this.generateViaHuggingFace(enhancedPrompt, hfToken);
        if (hfResult && Buffer.isBuffer(hfResult.buffer)) {
          const media = detectMediaType(hfResult.buffer);
          return {
            buffer: hfResult.buffer,
            url: hfResult.url,
            originalPrompt,
            enhancedPrompt,
            provider: "huggingface",
            isVideo: media.isVideo,
            mimeType: media.mimeType,
          };
        }
      } catch (hfErr) {
        logger.warn(
          { hfErr },
          "Hugging Face video generation failed or model is loading; falling back to free community video cluster",
        );
      }
    }

    // 3. Free Community Video Cluster (Zero Cost, No API Key needed)
    logger.info({ originalPrompt, enhancedPrompt }, "Generating video via Free Community cluster");
    const communityResult = await this.generateViaCommunity(enhancedPrompt);
    const media = detectMediaType(communityResult.buffer);
    return {
      buffer: communityResult.buffer,
      url: communityResult.url,
      originalPrompt,
      enhancedPrompt,
      provider: "community",
      isVideo: media.isVideo,
      mimeType: media.mimeType,
    };
  }

  /**
   * Generates video via Hugging Face Serverless Inference API
   */
  private static async generateViaHuggingFace(
    prompt: string,
    token: string,
  ): Promise<{ buffer: Buffer; url: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    const customModel = process.env.HF_VIDEO_MODEL?.trim();
    const endpoints = [
      customModel ? `https://router.huggingface.co/hf-inference/models/${customModel}` : null,
      "https://router.huggingface.co/hf-inference/models/damo-vilab/modelscope-damo-text-to-video",
    ].filter(Boolean) as string[];

    try {
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ inputs: prompt }),
          });

          if (response.ok) {
            const arrayBuf = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuf);
            if (buffer.length > 2000) {
              return { buffer, url: endpoint };
            }
          }
        } catch {
          // Try next endpoint
        }
      }
      throw new Error("Hugging Face video generation endpoints did not return valid video data");
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Generates video via free community endpoint
   */
  private static async generateViaCommunity(
    prompt: string,
  ): Promise<{ buffer: Buffer; url: string }> {
    const seed = Math.floor(Math.random() * 1_000_000);
    const encoded = encodeURIComponent(prompt.slice(0, 400));
    const communityUrl = `https://image.pollinations.ai/prompt/${encoded}?model=video&nologo=true&seed=${seed}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000); // 55s timeout for video

    try {
      const response = await fetch(communityUrl, {
        signal: controller.signal,
        headers: {
          Accept: "video/mp4,video/*,*/*",
          "User-Agent": "TelegramAIStudioBot/2.0",
        },
      });

      if (!response.ok) {
        throw new Error(`Community video endpoint returned HTTP ${response.status}`);
      }

      const arrayBuf = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      if (buffer.length < 1000) {
        throw new Error("Community video returned empty or corrupted payload");
      }

      return {
        buffer,
        url: communityUrl,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Extracts visual video subject from command or conversation
   */
  static extractVideoPrompt(rawText: string): string {
    return rawText
      .replace(/^\/(video|vid|clip|generate_video|movie)\s*/i, "")
      .replace(
        /^(please\s+)?(can you\s+)?(generate|create|render|make|produce)\s+(me\s+)?(an?\s+)?(video|clip|animation|short film|movie)\s+(of|about|showing|depicting)?\s*/i,
        "",
      )
      .trim();
  }
}
