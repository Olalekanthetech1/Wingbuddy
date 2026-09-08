export interface GeminiModelSelectionContext {
  mode?: string;
  enableSearch?: boolean;
  isDeepReasoning?: boolean;
  isExtraction?: boolean;
}

function parseModels(value?: string): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(models: string[]): string[] {
  return [...new Set(models)];
}

/**
 * Runtime-configured Gemini model routing.
 * No model ID is baked into the execution service. The deployment decides
 * which stable models are primary, role-specific, and fallback candidates.
 */
export class GeminiModelPoolService {
  getCandidates(
    configuredModel: string,
    context: GeminiModelSelectionContext = {},
  ): string[] {
    const primary = configuredModel?.trim();
    const globalPool = parseModels(process.env.GEMINI_MODEL_POOL);
    const fast = process.env.GEMINI_MODEL_FAST?.trim();
    const reasoning = process.env.GEMINI_MODEL_REASONING?.trim();
    const extraction = process.env.GEMINI_MODEL_EXTRACTION?.trim();
    const configuredFallbacks = parseModels(process.env.GEMINI_MODEL_FALLBACKS);

    const preferred = context.isExtraction
      ? extraction
      : context.isDeepReasoning || context.mode === "deep_research" || context.mode === "coder" || context.mode === "math"
        ? reasoning
        : context.enableSearch || context.mode === "general" || context.mode === "study" || context.mode === "creative"
          ? fast
          : undefined;

    return unique([
      preferred || primary,
      primary,
      ...globalPool,
      ...configuredFallbacks,
    ].filter((model): model is string => Boolean(model)));
  }
}

export const geminiModelPoolService = new GeminiModelPoolService();
