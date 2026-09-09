import { describe, expect, it, beforeEach } from "vitest";
import { AdaptiveIntentService } from "../src/services/adaptive-intent.service";
import { semanticInteractionCache, type SemanticInteractionDecision } from "../src/services/semantic-interaction-cache.service";
import type { ModeKey } from "../src/config/mode";

describe("AdaptiveIntentService - Semantic Interaction Contract", () => {
  beforeEach(() => semanticInteractionCache.clear());

  const seed = (text: string, decision: Partial<SemanticInteractionDecision> & Pick<SemanticInteractionDecision, "intent">, mode: ModeKey = "general") => {
    semanticInteractionCache.set(text, mode, [], {
      intent: decision.intent,
      effectiveMode: decision.effectiveMode,
      requiredCapabilities: decision.requiredCapabilities || [],
      enableSearch: decision.enableSearch ?? false,
      thinkingLevel: decision.thinkingLevel,
      isModeSwitch: decision.isModeSwitch ?? false,
      requestedMode: decision.requestedMode,
      cleanedPrompt: decision.cleanedPrompt,
      isGreeting: decision.isGreeting ?? false,
      complexity: decision.complexity ?? "simple",
      confidence: decision.confidence ?? 0.99,
    });
  };

  it("projects semantic live-search decisions without lexical inspection", () => {
    const query = "What were the key announcements at Google I/O today?";
    seed(query, { intent: "search_grounding", enableSearch: true, effectiveMode: "deep_research" });
    const plan = AdaptiveIntentService.analyze(query, "general");
    expect(plan.enableSearch).toBe(true);
    expect(plan.detectedIntent).toBe("search_grounding");
  });

  it("projects semantic reasoning decisions", () => {
    const query = "Design a distributed idempotency lock in Redis considering concurrency and network partitions";
    seed(query, { intent: "deep_reasoning", thinkingLevel: "LOW", effectiveMode: "math" });
    const plan = AdaptiveIntentService.analyze(query, "general");
    expect(plan.thinkingLevel).toBe("LOW");
    expect(plan.detectedIntent).toBe("deep_reasoning");
  });

  it("projects semantic coding decisions", () => {
    const query = "Write a TypeScript helper to debouncing an async API call with generic types";
    seed(query, { intent: "coding", effectiveMode: "coder" });
    const plan = AdaptiveIntentService.analyze(query, "general");
    expect(plan.detectedIntent).toBe("coding");
  });

  it("projects semantic image and video decisions with cleaned prompts", () => {
    const image = "Create a cinematic image of a cybernetic tiger";
    seed(image, { intent: "image_generation", cleanedPrompt: "a cinematic image of a cybernetic tiger" });
    const imagePlan = AdaptiveIntentService.analyze(image, "general");
    expect(imagePlan.detectedIntent).toBe("image_generation");
    expect(imagePlan.imagePrompt).toBe("a cinematic image of a cybernetic tiger");

    const video = "Create a cinematic video of a rocket launch";
    seed(video, { intent: "video_generation", cleanedPrompt: "a cinematic video of a rocket launch" });
    const videoPlan = AdaptiveIntentService.analyze(video, "general");
    expect(videoPlan.detectedIntent).toBe("video_generation");
    expect(videoPlan.videoPrompt).toBe("a cinematic video of a rocket launch");
  });

  it("keeps cold-cache behavior neutral and fail-closed", () => {
    const query = "Create whatever you think is best for me today";
    const plan = AdaptiveIntentService.analyze(query, "general");
    expect(plan.enableSearch).toBe(false);
    expect(plan.thinkingLevel).toBeUndefined();
    expect(plan.detectedIntent).toBe("general");
    expect(plan.imagePrompt).toBeUndefined();
    expect(plan.videoPrompt).toBeUndefined();
  });

  it("honors semantic greeting resolution in deep-research mode", () => {
    const greeting = "Hello! Hope you are having a nice day.";
    seed(greeting, { intent: "greeting", isGreeting: true, effectiveMode: "deep_research", enableSearch: false }, "deep_research");
    const plan = AdaptiveIntentService.analyze(greeting, "deep_research");
    expect(plan.enableSearch).toBe(false);
    expect(plan.detectedIntent).toBe("general");
  });
});
