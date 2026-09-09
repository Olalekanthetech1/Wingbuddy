import { beforeEach, describe, expect, it } from "vitest";
import { semanticInteractionCache, type SemanticInteractionDecision } from "../src/services/semantic-interaction-cache.service";

const baseDecision: SemanticInteractionDecision = {
  intent: "general",
  effectiveMode: "auto",
  requiredCapabilities: [],
  enableSearch: false,
  isModeSwitch: false,
  isGreeting: false,
  complexity: "simple",
  confidence: 0.9,
};

describe("semanticInteractionCache", () => {
  beforeEach(() => semanticInteractionCache.clear());

  it("reuses the exact fingerprinted turn", () => {
    semanticInteractionCache.set("continue this", "auto", [{ role: "model", content: "story" }], baseDecision);
    expect(
      semanticInteractionCache.get("continue this", "auto", [{ role: "model", content: "story" }]),
    ).toEqual(baseDecision);
  });

  it("does not return an ambiguous text-only result when identical text has distinct decisions", () => {
    semanticInteractionCache.set("go", "auto", [], { ...baseDecision, taskIntent: "CONTINUE_TASK" });
    semanticInteractionCache.set("go", "auto", [], { ...baseDecision, taskIntent: "CANCEL_TASK" });
    expect(semanticInteractionCache.getLatestForText("go")).toBeUndefined();
  });

  it("returns a text-only result when all active decisions agree", () => {
    const decision = { ...baseDecision, taskIntent: "CONTINUE_TASK" as const };
    semanticInteractionCache.set("go", "auto", [], decision);
    semanticInteractionCache.set("go", "auto", [], decision);
    expect(semanticInteractionCache.getLatestForText("go")).toEqual(decision);
  });
});
