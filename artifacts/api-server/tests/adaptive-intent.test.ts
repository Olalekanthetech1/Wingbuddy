import { describe, expect, it } from "vitest";
import { AdaptiveIntentService } from "../src/services/adaptive-intent.service";

describe("AdaptiveIntentService - Systematic Intent & Mode Detection", () => {
  it("automatically detects live search grounding for temporal and factual queries", () => {
    const queries = [
      "What were the key announcements at Google I/O today?",
      "Who won the match yesterday?",
      "What is the current price of Bitcoin?",
      "What are the latest updates on TypeScript 5.8?",
      "Check online what the weather is in Tokyo right now",
    ];

    for (const q of queries) {
      const plan = AdaptiveIntentService.analyze(q, "general");
      expect(plan.enableSearch).toBe(true);
      expect(plan.effectiveModeInstruction).toContain("research");
    }
  });

  it("automatically detects deep reasoning and thinking mode for logic, architecture, and math", () => {
    const queries = [
      "Solve this equation and prove why the solution holds: 2x^2 + 5x - 3 = 0",
      "Design a distributed idempotency lock in Redis considering concurrency and network partitions",
      "Why does this code cause a deadlock? Walk me through step by step",
      "Analyze the trade-offs between Spanner, Postgres, and DynamoDB for global consistency",
    ];

    for (const q of queries) {
      const plan = AdaptiveIntentService.analyze(q, "general");
      expect(plan.thinkingLevel).toBe("LOW");
      expect(plan.effectiveModeInstruction).toContain("reasoning");
    }
  });

  it("automatically detects coding intent for programming snippets without manual mode switch", () => {
    const query = "Write a TypeScript helper to debouncing an async API call with generic types";
    const plan = AdaptiveIntentService.analyze(query, "general");
    expect(plan.detectedIntent).toBe("coding");
    expect(plan.effectiveModeInstruction).toContain("coding assistant");
  });

  it("keeps standard casual conversation lightweight without unnecessary search overhead", () => {
    const query = "Good morning! How are you doing today? Just wanted to say hello.";
    // Notice "today" is in conversational context, but let's check general casual conversation:
    const casual = "Tell me a fun bedtime story about a baby dragon.";
    const plan = AdaptiveIntentService.analyze(casual, "general");
    expect(plan.enableSearch).toBe(false);
    expect(plan.thinkingLevel).toBeUndefined();
    expect(plan.detectedIntent).toBe("general");
  });

  it("augments explicit user modes when complex logic is demanded", () => {
    const query = "Solve this difficult physics equation step by step";
    const plan = AdaptiveIntentService.analyze(query, "study");
    expect(plan.thinkingLevel).toBe("LOW");
    expect(plan.effectiveModeInstruction).toContain("SYSTEMATIC ADAPTATION");
  });

  it("automatically detects image generation requests and extracts prompt", () => {
    const imageQueries = [
      "Can you generate an image of a cybernetic tiger in a futuristic jungle?",
      "Draw me a picture of a cozy mountain cabin under the northern lights",
      "Generate an illustration of a vintage coffee shop in Paris, watercolor style",
      "/image a retro synthwave sports car speeding on a neon grid",
    ];

    for (const q of imageQueries) {
      const plan = AdaptiveIntentService.analyze(q, "general");
      expect(plan.detectedIntent).toBe("image_generation");
      expect(plan.imagePrompt).toBeDefined();
      expect(plan.imagePrompt!.length).toBeGreaterThan(5);
    }
  });

  it("automatically detects video generation requests and extracts prompt", () => {
    const videoQueries = [
      "Can you generate a video of fireworks exploding over a mountain lake?",
      "Create a video of a golden retriever puppy chasing bubbles in slow motion",
      "Make an animation of a spaceship entering hyperspace",
      "/video a drone flythrough of ancient Mayan ruins in the jungle",
    ];

    for (const q of videoQueries) {
      const plan = AdaptiveIntentService.analyze(q, "general");
      expect(plan.detectedIntent).toBe("video_generation");
      expect(plan.videoPrompt).toBeDefined();
      expect(plan.videoPrompt!.length).toBeGreaterThan(5);
    }
  });
});
