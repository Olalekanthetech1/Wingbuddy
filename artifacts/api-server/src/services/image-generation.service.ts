import { logger } from "../lib/logger";
import type { GeminiService } from "../gemini/gemini.service";
import { aiProviderGatewayService } from "./ai-provider-gateway.service";
import { huggingFaceCapabilityService } from "./huggingface-capability.service";

export interface GeneratedImageResult {
  buffer: Buffer;
  url: string;
  originalPrompt: string;
  enhancedPrompt: string;
  provider?: "huggingface" | "community";
  route?: "inference_provider" | "community";
  model?: string;
  fallbackUsed?: boolean;
}

export class ImageGenerationService {
  static async enhancePrompt(rawPrompt: string, geminiService?: GeminiService): Promise<string> {
    const cleaned = rawPrompt.trim();
    if (!geminiService || cleaned.length > 280) return cleaned;
    try {
      const systemInstruction = "You are an expert prompt engineer for modern text-to-image models. Expand the user's idea into a single, visually striking, highly descriptive prompt detailing subjects, lighting, artistic style, composition, colors, and camera angle. Output ONLY the final image generation prompt in English. No explanations, no preamble, no quotes, no markdown formatting.";
      const promptRequest = `Expand this idea into a vivid image generation prompt: "${cleaned}"`;
      const timeoutPromise = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Prompt enhancement timeout")), 4000));
      const enhancePromise = geminiService.generateReply([], promptRequest, { modeInstruction: systemInstruction }, { thinkingLevel: undefined, enableSearch: false });
      const enhanced = await Promise.race([enhancePromise, timeoutPromise]);
      const result = enhanced.replace(/^[“"']+|[”"']+$/g, "").replace(/^Prompt:\s*/i, "").trim();
      return result.length > 10 ? result : cleaned;
    } catch (err) {
      logger.warn({ err, originalPrompt: cleaned }, "Prompt enhancement failed or timed out; falling back to original prompt");
      return cleaned;
    }
  }

  static async generate(rawPrompt: string, geminiService?: GeminiService, options: { width?: number; height?: number } = {}): Promise<GeneratedImageResult> {
    const originalPrompt = rawPrompt.trim();
    const enhancedPrompt = await this.enhancePrompt(originalPrompt, geminiService);
    const width = options.width || 1024;
    const height = options.height || 1024;
    const preferredModel = process.env.HF_IMAGE_MODEL?.trim() || undefined;
    const capability = await huggingFaceCapabilityService.resolveModel("text-to-image", preferredModel);

    logger.info({ originalPrompt, enhancedPrompt, width, height, model: capability.model, discovered: capability.discovered, preferredAvailable: capability.preferredAvailable }, "Generating image through dynamically selected Hugging Face capability");
    const execution = await aiProviderGatewayService.generateImage("huggingface", {
      model: capability.model,
      prompt: enhancedPrompt,
      width,
      height,
      metadata: { originalPrompt, capabilityDiscovery: capability.discovered, preferredModelAvailable: capability.preferredAvailable },
    });
    const result = execution.result;
    const provider = result.route === "community" ? "community" : "huggingface";

    return {
      buffer: result.buffer,
      url: result.sourceUrl || `huggingface://image/${encodeURIComponent(result.model)}`,
      originalPrompt,
      enhancedPrompt,
      provider,
      route: result.route,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
    };
  }

  static extractImagePrompt(rawText: string): string {
    return rawText
      .replace(/^\/(image|draw|img|generate_image|paint)\s*/i, "")
      .replace(/^(please\s+)?(can you\s+)?(generate|create|draw|paint|render|make|produce|visualize)\s+(me\s+)?(an?\s+)?(image|picture|photo|illustration|drawing|portrait|wallpaper|painting|artwork)\s+(of|about|showing|depicting)?\s*/i, "")
      .replace(/^(draw|paint|illustrate|sketch)\s+(me\s+)?/i, "")
      .trim();
  }
}
