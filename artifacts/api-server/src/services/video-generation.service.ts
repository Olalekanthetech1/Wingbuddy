import { logger } from "../lib/logger";
import type { GeminiService } from "../gemini/gemini.service";
import { huggingFaceMediaService } from "./huggingface-media.service";

export interface GeneratedVideoResult { buffer: Buffer; url: string; originalPrompt: string; enhancedPrompt: string; provider: "huggingface" | "community"; isVideo: boolean; mimeType: string; model?: string; }

export class VideoGenerationService {
  static async enhanceVideoPrompt(rawPrompt: string, geminiService?: GeminiService): Promise<string> {
    const cleaned = rawPrompt.trim(); if (!geminiService || cleaned.length > 280) return cleaned;
    try {
      const systemInstruction = "You are an expert prompt engineer for modern text-to-video models. Expand the idea into one cinematic video prompt with subject, camera movement, motion, atmosphere, and lighting. Output ONLY the final prompt in English, maximum 50 words, with no quotes or markdown.";
      const promptRequest = `Expand this idea into a cinematic video generation prompt: "${cleaned}"`;
      const timeoutPromise = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Video prompt enhancement timeout")), 4000));
      const enhanced = await Promise.race([geminiService.generateReply([], promptRequest, { modeInstruction: systemInstruction }, { thinkingLevel: undefined, enableSearch: false }), timeoutPromise]);
      const result = enhanced.replace(/^[“"']+|[”"']+$/g, "").replace(/^Prompt:\s*/i, "").trim();
      return result.length > 10 ? result : cleaned;
    } catch (err) { logger.warn({ err, originalPrompt: cleaned }, "Video prompt enhancement failed; using original prompt"); return cleaned; }
  }

  static async generate(rawPrompt: string, geminiService?: GeminiService, options: { model?: string } = {}): Promise<GeneratedVideoResult> {
    const originalPrompt = rawPrompt.trim();
    const enhancedPrompt = await this.enhanceVideoPrompt(originalPrompt, geminiService);
    const result = await huggingFaceMediaService.generateVideo(enhancedPrompt, { model: options.model });
    return { buffer: result.buffer, url: "", originalPrompt, enhancedPrompt, provider: "huggingface", isVideo: true, mimeType: result.mimeType, model: result.model };
  }

  static extractVideoPrompt(rawText: string): string {
    return rawText.replace(/^\/(video|vid|clip|generate_video|movie)\s*/i, "").replace(/^(please\s+)?(can you\s+)?(generate|create|render|make|produce)\s+(me\s+)?(an?\s+)?(video|clip|animation|short film|movie)\s+(of|about|showing|depicting)?\s*/i, "").trim();
  }
}
