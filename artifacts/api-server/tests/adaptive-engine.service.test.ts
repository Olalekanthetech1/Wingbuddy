import { describe, expect, it } from "vitest";
import { AdaptiveEngineService } from "../src/services/adaptive-engine.service";
import { RateLimitService } from "../src/services/rate-limit.service";
import { apiKeyPoolService } from "../src/services/api-key-pool.service";

describe("AdaptiveEngineService", () => {
  describe("Adaptive History Window", () => {
    it("dynamically allocates deeper history for coder and reasoning modes", () => {
      const generalLimit = AdaptiveEngineService.computeAdaptiveHistoryLimit({ mode: "general" });
      const coderLimit = AdaptiveEngineService.computeAdaptiveHistoryLimit({ mode: "coder" });
      const conciseLimit = AdaptiveEngineService.computeAdaptiveHistoryLimit({ mode: "concise" });

      expect(coderLimit).toBeGreaterThan(generalLimit);
      expect(generalLimit).toBeGreaterThan(conciseLimit);
    });

    it("dynamically adapts when message is very long vs short follow-up", () => {
      const shortFollowup = AdaptiveEngineService.computeAdaptiveHistoryLimit({
        mode: "general",
        currentMessage: "why?",
      });
      const longPrompt = AdaptiveEngineService.computeAdaptiveHistoryLimit({
        mode: "general",
        currentMessage: "a".repeat(1500),
      });

      expect(shortFollowup).toBeGreaterThan(longPrompt);
    });

    it("balances history slice when high memory load is present", () => {
      const lowMemory = AdaptiveEngineService.computeAdaptiveHistoryLimit({
        mode: "general",
        memoriesCount: 0,
        semanticRecallCount: 0,
      });
      const highMemory = AdaptiveEngineService.computeAdaptiveHistoryLimit({
        mode: "general",
        memoriesCount: 8,
        semanticRecallCount: 5,
      });

      expect(lowMemory).toBeGreaterThanOrEqual(highMemory);
    });
  });

  describe("Adaptive Timeout Calculation", () => {
    it("dynamically scales timeout for search and deep reasoning", () => {
      const basicTimeout = AdaptiveEngineService.computeAdaptiveTimeout({
        prompt: "Hello",
        enableSearch: false,
      });
      const searchTimeout = AdaptiveEngineService.computeAdaptiveTimeout({
        prompt: "Search latest news on AI",
        enableSearch: true,
      });
      const reasoningTimeout = AdaptiveEngineService.computeAdaptiveTimeout({
        prompt: "Write a complete distributed consensus algorithm in Rust",
        isDeepReasoning: true,
      });

      expect(searchTimeout).toBeGreaterThan(basicTimeout);
      expect(reasoningTimeout).toBeGreaterThan(basicTimeout);
    });
  });

  describe("Adaptive Rate Limiting", () => {
    it("dynamically provides capacity based on key pool health", () => {
      const rateLimiter = new RateLimitService();
      // Should allow normal consumption
      expect(rateLimiter.consume(999)).toBe(true);

      const status = rateLimiter.getQuotaStatus(999);
      expect(status.max).toBeGreaterThanOrEqual(8);
      expect(status.remaining).toBeLessThan(status.max);
    });
  });

  describe("Adaptive Model Selection", () => {
    it("selects fast flash tier for quick conversational messages", () => {
      const model = AdaptiveEngineService.computeAdaptiveModel({
        mode: "casual",
        prompt: "Hello! How are you doing today?",
      });
      expect(model).toBe("gemini-2.5-flash");
    });

    it("selects pro tier for deep reasoning and complex coding tasks", () => {
      const coderModel = AdaptiveEngineService.computeAdaptiveModel({
        mode: "coder",
        prompt: "Write a high-performance LRU cache in TypeScript",
      });
      expect(coderModel).toBe("gemini-2.5-pro");

      const reasoningModel = AdaptiveEngineService.computeAdaptiveModel({
        isDeepReasoning: true,
        prompt: "Prove mathematically that the square root of 2 is irrational",
      });
      expect(reasoningModel).toBe("gemini-2.5-pro");
    });

    it("selects fast tier for background factual extraction", () => {
      const extractionModel = AdaptiveEngineService.computeAdaptiveModel({
        isExtraction: true,
      });
      expect(extractionModel).toBe("gemini-2.5-flash");
    });

    it("respects explicit custom model overrides when specified by user", () => {
      const overrideModel = AdaptiveEngineService.computeAdaptiveModel({
        prompt: "Hello",
        configuredModel: "custom-fine-tuned-model",
      });
      expect(overrideModel).toBe("custom-fine-tuned-model");
    });
  });
});

