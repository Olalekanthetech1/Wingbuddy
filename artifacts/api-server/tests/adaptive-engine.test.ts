import { describe, expect, it } from "vitest";
import { AdaptiveEngineService } from "../src/services/adaptive-engine.service";

describe("AdaptiveEngineService", () => {
  describe("computeAdaptiveStreamingInterval", () => {
    it("starts with fast responsive interval for short initial bursts", () => {
      const interval = AdaptiveEngineService.computeAdaptiveStreamingInterval({
        characterLength: 40,
        velocityCharsPerSec: 10,
      });
      expect(interval).toBeLessThanOrEqual(300);
      expect(interval).toBeGreaterThanOrEqual(250);
    });

    it("scales up dynamically for longer text to conserve Telegram API rate limits", () => {
      const interval = AdaptiveEngineService.computeAdaptiveStreamingInterval({
        characterLength: 1500,
        velocityCharsPerSec: 120,
      });
      expect(interval).toBeGreaterThanOrEqual(750);
    });

    it("adapts dynamically to high API latency", () => {
      const interval = AdaptiveEngineService.computeAdaptiveStreamingInterval({
        characterLength: 500,
        lastApiLatencyMs: 650,
      });
      expect(interval).toBeGreaterThanOrEqual(730);
    });
  });

  describe("computeAdaptiveMessageSplit", () => {
    it("returns single chunk if under limit", () => {
      const text = "Hello world, this is a short message.";
      const chunks = AdaptiveEngineService.computeAdaptiveMessageSplit(text);
      expect(chunks).toEqual([text]);
    });

    it("intelligently splits at paragraph boundaries and preserves code fences", () => {
      const codePart = "```typescript\nconst a = 1;\nconst b = 2;\n```";
      const longText = `Section 1\n\n${"A".repeat(2500)}\n\n${codePart}\n\n${"B".repeat(2500)}`;
      const chunks = AdaptiveEngineService.computeAdaptiveMessageSplit(longText, { maxLimit: 3000 });
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(3050);
      }
    });

    it("auto-repairs unclosed code fences across chunk boundaries", () => {
      const codeInside = "```python\n" + "print('line')\n".repeat(200);
      const chunks = AdaptiveEngineService.computeAdaptiveMessageSplit(codeInside, { maxLimit: 800 });
      expect(chunks.length).toBeGreaterThan(1);
      // First chunk should have closing fence
      expect(chunks[0].endsWith("```")).toBe(true);
      // Second chunk should continue code block
      expect(chunks[1].startsWith("```python")).toBe(true);
    });
  });
});
