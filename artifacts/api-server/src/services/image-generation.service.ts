import { logger } from "../lib/logger";
import type { GeminiService } from "../gemini/gemini.service";
import { huggingFaceMediaService } from "./huggingface-media.service";

export interface GeneratedImageResult { buffer: Buffer; url: string; originalPrompt: string; enhancedPrompt: string; provider?: "huggingface" | "community"; mimeType?: string; model?: string; }

export class ImageGenerationService {
  static async enhancePrompt(rawPrompt: string, geminiService?: GeminiService): Promise<string> {
    const cleaned = rawPrompt.trim(); if (!geminiService || cleaned.length > 280) return cleaned;
    try {
      const systemInstruction = "You are an expert prompt engineer for modern text-to-image models. Expand the user's idea into one vivid, descriptive image prompt covering subject, composition, lighting, style, colors, and camera angle. Output ONLY the final prompt in English; no quotes or markdown.";
      const promptRequest = `Expand this idea into a vivid image generation prompt: "${cleaned}"`;
      const timeoutPromise = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Prompt enhancement timeout")), 4000));
      const enhanced = await Promise.race([geminiService.generateReply([], promptRequest, { modeInstruction: systemInstruction }, { thinkingLevel: undefined, enableSearch: false }), timeoutPromise]);
      const result = enhanced.replace(/^[“"']+|[”"']+$/g, "").replace(/^Prompt:\s*/i, "").trim();
      return result.length > 10 ? result : cleaned;
    } catch (err) { logger.warn({ err, originalPrompt: cleaned }, "Image prompt enhancement failed; using original prompt"); return cleaned; }
  }

  static async generate(rawPrompt: string, geminiService?: GeminiService, options: { width?: number; height?: number; model?: string } = {}): Promise<GeneratedImageResult> {
    const originalPrompt = rawPrompt.trim();
    const enhancedPrompt = await this.enhancePrompt(originalPrompt, geminiService);
    const result = await huggingFaceMediaService.generateImage(enhancedPrompt, { model: options.model, width: options.width, height: options.height });
    return { buffer: result.buffer, url: "", originalPrompt, enhancedPrompt, provider: "huggingface", mimeType: result.mimeType, model: result.model };
  }

  static extractImagePrompt(rawText: string): string {
    return rawText.replace(/^\/(image|draw|img|generate_image|paint)\s*/i, "").replace(/^(please\s+)?(can you\s+)?(generate|create|draw|paint|render|make|produce|visualize)\s+(me\s+)?(an?\s+)?(image|picture|photo|illustration|drawing|portrait|wallpaper|painting|artwork)\s+(of|about|showing|depicting)?\s*/i, "").replace(/^(draw|paint|illustrate|sketch)\s+(me\s+)?/i, "").trim();
  }
}
