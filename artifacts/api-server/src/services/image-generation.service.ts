import { logger } from "../lib/logger";
import type { GeminiService } from "../gemini/gemini.service";

export interface GeneratedImageResult {
  buffer: Buffer;
  url: string;
  originalPrompt: string;
  enhancedPrompt: string;
  provider?: "huggingface" | "community";
}

export class ImageGenerationService {
  /**
   * Enhances a user's short or basic prompt into a vivid, descriptive prompt
   * using Gemini Flash for higher-quality diffusion results.
   */
  static async enhancePrompt(
    rawPrompt: string,
    geminiService?: GeminiService,
  ): Promise<string> {
    const cleaned = rawPrompt.trim();
    if (!geminiService || cleaned.length > 280) {
      return cleaned;
    }

    try {
      const systemInstruction =
        "You are an expert prompt engineer for FLUX.1 and text-to-image models. " +
        "Expand the user's idea into a single, visually striking, highly descriptive prompt detailing subjects, lighting, artistic style, composition, colors, and camera angle. " +
        "Output ONLY the final image generation prompt in English. No explanations, no preamble, no quotes, no markdown formatting.";

      const promptRequest = `Expand this idea into a vivid image generation prompt: "${cleaned}"`;

      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("Prompt enhancement timeout")), 4000),
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
        "Prompt enhancement failed or timed out; falling back to original prompt",
      );
      return cleaned;
    }
  }

  /**
   * Generates a high-resolution image using Hugging Face FLUX.1-schnell if HF_TOKEN is present,
   * or the free community FLUX.1 cluster.
   */
  static async generate(
    rawPrompt: string,
    geminiService?: GeminiService,
    options: { width?: number; height?: number } = {},
  ): Promise<GeneratedImageResult> {
    const originalPrompt = rawPrompt.trim();
    const width = options.width || 1024;
    const height = options.height || 1024;
    const hfToken = process.env.HF_TOKEN?.trim();

    // 1. Optional bonus: Enhance prompt with Gemini Flash
    const enhancedPrompt = await this.enhancePrompt(originalPrompt, geminiService);

    // 2. If HF_TOKEN is set, try Hugging Face Serverless FLUX.1-schnell
    if (hfToken) {
      try {
        logger.info({ originalPrompt, enhancedPrompt }, "Generating image via Hugging Face FLUX.1-schnell");
        const hfImage = await this.generateViaHuggingFace(enhancedPrompt, hfToken);
        if (hfImage) {
          return {
            buffer: hfImage.buffer,
            url: hfImage.url,
            originalPrompt,
            enhancedPrompt,
            provider: "huggingface",
          };
        }
      } catch (hfErr) {
        logger.warn(
          { hfErr },
          "Hugging Face image generation failed; falling back to community cluster",
        );
      }
    }

    // 3. Fallback / Default: Free Community FLUX cluster
    const seed = Math.floor(Math.random() * 1_000_000);
    const encodedPrompt = encodeURIComponent(enhancedPrompt.slice(0, 800));
    const primaryUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=flux&nologo=true&seed=${seed}`;

    logger.info(
      { originalPrompt, enhancedPrompt, width, height, seed },
      "Generating image via free FLUX community cluster",
    );

    let buffer: Buffer | null = null;
    let finalUrl = primaryUrl;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 40_000);

      const response = await fetch(primaryUrl, {
        signal: controller.signal,
        headers: {
          Accept: "image/jpeg,image/png,image/*",
          "User-Agent": "TelegramAIStudioBot/2.0",
        },
      });
      clearTimeout(timeout);

      if (response.ok) {
        const arrayBuf = await response.arrayBuffer();
        buffer = Buffer.from(arrayBuf);
      } else {
        throw new Error(`Primary FLUX endpoint returned HTTP ${response.status}`);
      }
    } catch (primaryErr) {
      logger.warn(
        { primaryErr, primaryUrl },
        "Primary FLUX generation failed or timed out; attempting fast fallback model",
      );

      // Fallback to fast turbo model
      const fallbackUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=turbo&nologo=true&seed=${seed}`;
      finalUrl = fallbackUrl;

      const fallbackController = new AbortController();
      const fallbackTimeout = setTimeout(() => fallbackController.abort(), 30_000);

      const fallbackRes = await fetch(fallbackUrl, {
        signal: fallbackController.signal,
        headers: {
          Accept: "image/jpeg,image/png,image/*",
          "User-Agent": "TelegramAIStudioBot/2.0",
        },
      });
      clearTimeout(fallbackTimeout);

      if (!fallbackRes.ok) {
        throw new Error(`Image generation failed with HTTP ${fallbackRes.status}`);
      }

      const fallbackArrayBuf = await fallbackRes.arrayBuffer();
      buffer = Buffer.from(fallbackArrayBuf);
    }

    if (!buffer || buffer.length < 1000) {
      throw new Error("Received empty or invalid image data from generation cluster");
    }

    return {
      buffer,
      url: finalUrl,
      originalPrompt,
      enhancedPrompt,
      provider: "community",
    };
  }

  /**
   * Generates image via Hugging Face Serverless Inference API if available
   */
  private static async generateViaHuggingFace(
    prompt: string,
    token: string,
  ): Promise<{ buffer: Buffer; url: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);

    const customModel = process.env.HF_IMAGE_MODEL?.trim();
    const endpoints = [
      customModel ? `https://router.huggingface.co/hf-inference/models/${customModel}` : null,
      "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
      "https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-xl-base-1.0",
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
              Accept: "image/jpeg,image/png,image/*",
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
          // Continue to next endpoint or fallback
        }
      }
      throw new Error("Hugging Face serverless image models unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Helper to strip command trigger words and extract the real visual subject
   */
  static extractImagePrompt(rawText: string): string {
    return rawText
      .replace(/^\/(image|draw|img|generate_image|paint)\s*/i, "")
      .replace(
        /^(please\s+)?(can you\s+)?(generate|create|draw|paint|render|make|produce|visualize)\s+(me\s+)?(an?\s+)?(image|picture|photo|illustration|drawing|portrait|wallpaper|painting|artwork)\s+(of|about|showing|depicting)?\s*/i,
        "",
      )
      .replace(/^(draw|paint|illustrate|sketch)\s+(me\s+)?/i, "")
      .trim();
  }
}
