import { beforeEach, describe, expect, it, vi } from "vitest";
import { SemanticInteractionResolverService } from "../src/services/semantic-interaction-resolver.service";
import { semanticInteractionCache } from "../src/services/semantic-interaction-cache.service";
import { ExecutionPlannerService } from "../src/services/execution-planner.service";
import { ModeService } from "../src/services/mode.service";

const history = [
  { role: "user", content: "We are working on this project." },
  { role: "model", content: "Understood." },
];

function mockGemini(response: unknown) {
  return {
    generateReply: vi.fn().mockResolvedValue(JSON.stringify(response)),
  } as any;
}

describe("semantic interaction routing", () => {
  beforeEach(() => semanticInteractionCache.clear());

  it("classifies semantically without phrase-specific routing", async () => {
    const gemini = mockGemini({
      intent: "search_grounding",
      effectiveMode: "deep_research",
      requiredCapabilities: ["web_research", "source_verification"],
      enableSearch: true,
      thinkingLevel: "MEDIUM",
      isModeSwitch: false,
      isGreeting: false,
      complexity: "moderate",
      confidence: 0.96,
    });

    const result = await SemanticInteractionResolverService.resolve({
      text: "Investigate what has changed in the AI landscape and support the findings with current evidence.",
      persistentMode: "auto",
      history,
      gemini,
    });

    expect(result.intent).toBe("search_grounding");
    expect(result.enableSearch).toBe(true);
    expect(result.requiredCapabilities).toContain("source_verification");
    expect(gemini.generateReply).toHaveBeenCalledTimes(1);
  });

  it("reuses the same semantic decision for downstream planning", async () => {
    const gemini = mockGemini({
      intent: "coding",
      effectiveMode: "coder",
      requiredCapabilities: ["code_generation", "debugging"],
      enableSearch: false,
      thinkingLevel: "HIGH",
      isModeSwitch: false,
      isGreeting: false,
      complexity: "complex",
      confidence: 0.94,
    });

    const text = "Design a production solution for this concurrency problem with tests.";
    await SemanticInteractionResolverService.resolve({
      text,
      persistentMode: "auto",
      history,
      gemini,
    });

    const planner = new ExecutionPlannerService(new ModeService({} as any));
    const plan = planner.plan(text, "auto", history);

    expect(plan.effectiveMode).toBe("coder");
    expect(plan.detectedIntent).toBe("coding");
    expect(plan.thinkingLevel).toBe("HIGH");
    expect(plan.requiredCapabilities).toEqual(expect.arrayContaining(["code_generation", "debugging"]));
  });

  it("uses a conservative policy fallback when semantic routing is unavailable", () => {
    const planner = new ExecutionPlannerService(new ModeService({} as any));
    const plan = planner.plan("A request with no semantic classification", "auto", history);
    expect(plan.effectiveMode).toBe("general");
    expect(plan.enableSearch).toBe(false);
  });

  it("handles natural-language mode switches from the semantic result", async () => {
    const gemini = mockGemini({
      intent: "study",
      effectiveMode: "study",
      requestedMode: "study",
      requiredCapabilities: ["tutoring", "active_recall"],
      enableSearch: false,
      thinkingLevel: "LOW",
      isModeSwitch: true,
      cleanedPrompt: "help me understand this chapter",
      isGreeting: false,
      complexity: "moderate",
      confidence: 0.98,
    });

    const text = "Please switch me into a learning-focused approach and help me understand this chapter.";
    await SemanticInteractionResolverService.resolve({ text, persistentMode: "auto", history, gemini });

    const decision = semanticInteractionCache.getLatestForText(text);
    expect(decision?.isModeSwitch).toBe(true);
    expect(decision?.requestedMode).toBe("study");
    expect(decision?.cleanedPrompt).toBe("help me understand this chapter");
  });
});
