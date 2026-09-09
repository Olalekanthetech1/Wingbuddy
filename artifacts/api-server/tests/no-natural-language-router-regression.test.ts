import { describe, expect, it, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AdaptiveIntentService } from "../src/services/adaptive-intent.service";
import { semanticInteractionCache } from "../src/services/semantic-interaction-cache.service";

describe("natural-language routing architecture", () => {
  beforeEach(() => semanticInteractionCache.clear());

  it("keeps natural-language interpretation outside compatibility/router services", async () => {
    const root = resolve(process.cwd(), "src/services");
    const [adaptiveIntent, executionPlanner, modeService] = await Promise.all([
      readFile(resolve(root, "adaptive-intent.service.ts"), "utf8"),
      readFile(resolve(root, "execution-planner.service.ts"), "utf8"),
      readFile(resolve(root, "mode.service.ts"), "utf8"),
    ]);

    // Explicit Telegram protocol commands may use deterministic parsing.
    expect(adaptiveIntent).toContain("/^\\/mode(?:\\s+([a-z_]+))?$/i");

    // These services must consume semantic decisions, not classify raw vocabulary.
    expect(adaptiveIntent).toContain("semanticInteractionCache.get");
    expect(executionPlanner).toContain("semanticInteractionCache.get");
    expect(executionPlanner).not.toContain("inferAutoTurnMode");
    expect(modeService).toContain("resolveTurnMode");

    // No executable lexical classifier is permitted here.
    expect(adaptiveIntent).not.toMatch(/new\\s+RegExp\\s*\\(/);
    expect(executionPlanner).not.toMatch(/new\\s+RegExp\\s*\\(/);
    expect(adaptiveIntent).not.toContain(".test(");
    expect(executionPlanner).not.toContain(".test(");
    expect(adaptiveIntent).not.toContain(".match(");
    expect(executionPlanner).not.toContain(".match(");

    // Guard against the previous named heuristic families too.
    for (const marker of ["TEMPORAL_FACT_PATTERNS", "CODING_PATTERNS", "DEEP_REASONING_PATTERNS"]) {
      expect(adaptiveIntent).not.toContain(marker);
    }
  });

  it("fails closed when semantic resolution is unavailable", () => {
    const text = "Please switch to study mode and explain this topic";
    expect(AdaptiveIntentService.detectModeSwitchIntent(text)).toEqual({ isModeSwitch: false });
    const plan = AdaptiveIntentService.analyze(text, "auto");
    expect(plan.detectedIntent).toBe("general");
    expect(plan.enableSearch).toBe(false);
    expect(plan.imagePrompt).toBeUndefined();
    expect(plan.videoPrompt).toBeUndefined();
  });
});
