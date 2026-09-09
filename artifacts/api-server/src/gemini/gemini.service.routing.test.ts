import { describe, expect, it, vi } from "vitest";
import { GeminiService } from "./gemini.service";
import { adaptiveAIRouterService } from "../services/adaptive-ai-router.service";
import { geminiModelPoolService } from "../services/gemini-model-pool.service";

describe("GeminiService adaptive streaming integration", () => {
  it("routes ordinary streamed responses through the unified router", async () => {
    const router = vi.spyOn(adaptiveAIRouterService, "routeStream").mockImplementation(async function* () {
      yield { provider: "groq", model: "groq-test", delta: "Hello", done: false };
      yield { provider: "groq", model: "groq-test", delta: " world", done: false };
      yield { provider: "groq", model: "groq-test", delta: "", done: true };
    });
    const geminiPool = vi.spyOn(geminiModelPoolService, "getCandidates").mockReturnValue(["should-not-be-used"]);

    const service = new GeminiService("test-api-key", "legacy-gemini-model", 1000);
    const chunks: string[] = [];
    const result = await service.generateReplyStream([], "hello", undefined, undefined, async (value) => {
      chunks.push(value);
    });

    expect(result).toBe("Hello world");
    expect(chunks).toEqual(["Hello", "Hello world"]);
    expect(router).toHaveBeenCalledTimes(1);
    expect(router.mock.calls[0]?.[0]).toMatchObject({ model: "legacy-gemini-model" });
    expect(geminiPool).not.toHaveBeenCalled();

    router.mockRestore();
    geminiPool.mockRestore();
  });
});
