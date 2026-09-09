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
 * The persisted Model Registry is reflected into process.env by the registry
 * service after startup and on every Dashboard mutation. Model identity is
 * therefore never fixed inside this selection layer.
 */
export class GeminiModelPoolService {
  getCandidates(
    configuredModel: string,
    context: GeminiModelSelectionContext = {},
  ): string[] {
    // GEMINI_MODEL is the current runtime primary selected by the authoritative
    // registry. The constructor value is retained only as a bootstrap fallback
    // for callers created before registry synchronization.
    const primary = process.env.GEMINI_MODEL?.trim() || configuredModel?.trim();
    const globalPool = parseModels(process.env.GEMINI_MODEL_POOL);
    const fast = process.env.GEMINI_MODEL_FAST?.trim();
    const reasoning = process.env.GEMINI_MODEL_REASONING?.trim();
    const extraction = process.env.GEMINI_MODEL_EXTRACTION?.trim();
    const configuredFallbacks = parseModels(process.env.GEMINI_MODEL_FALLBACKS);

    const preferred = context.isExtraction
      ? extraction
      : context.isDeepReasoning
        ? reasoning
        : context.enableSearch && fast
          ? fast
          : undefined;

    return unique([
      preferred,
      primary,
      ...globalPool,
      ...configuredFallbacks,
    ].filter((model): model is string => Boolean(model)));
  }
}

export const geminiModelPoolService = new GeminiModelPoolService();
