import { describe, expect, it, afterEach } from "vitest";
import { GeminiModelPoolService } from "../src/services/gemini-model-pool.service";

describe("GeminiModelPoolService", () => {
  const original = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(original)) process.env[key] = value;
  });

  it("uses configured models and never injects a baked-in fallback", () => {
    process.env.GEMINI_MODEL_POOL = "primary-model,secondary-model";
    process.env.GEMINI_MODEL_FALLBACKS = "tertiary-model";
    process.env.GEMINI_MODEL_FAST = "fast-model";

    const service = new GeminiModelPoolService();
    expect(service.getCandidates("primary-model", { enableSearch: true })).toEqual([
      "fast-model",
      "primary-model",
      "secondary-model",
      "tertiary-model",
    ]);
  });

  it("prefers the configured reasoning model for deep work", () => {
    process.env.GEMINI_MODEL_REASONING = "reasoning-model";
    process.env.GEMINI_MODEL_POOL = "primary-model,backup-model";

    const service = new GeminiModelPoolService();
    expect(service.getCandidates("primary-model", { mode: "deep_research", isDeepReasoning: true })[0]).toBe("reasoning-model");
  });

  it("falls back to the configured primary when role-specific models are absent", () => {
    delete process.env.GEMINI_MODEL_FAST;
    delete process.env.GEMINI_MODEL_REASONING;
    delete process.env.GEMINI_MODEL_FALLBACKS;
    delete process.env.GEMINI_MODEL_POOL;

    const service = new GeminiModelPoolService();
    expect(service.getCandidates("primary-model", { enableSearch: true })).toEqual(["primary-model"]);
  });
});
