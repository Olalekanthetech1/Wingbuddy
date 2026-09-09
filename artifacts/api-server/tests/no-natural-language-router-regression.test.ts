import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("natural-language routing architecture", () => {
  it("does not reintroduce vocabulary-driven routing into the active router services", async () => {
    const root = resolve(process.cwd(), "src/services");
    const [adaptiveIntent, executionPlanner, modeService] = await Promise.all([
      readFile(resolve(root, "adaptive-intent.service.ts"), "utf8"),
      readFile(resolve(root, "execution-planner.service.ts"), "utf8"),
      readFile(resolve(root, "mode.service.ts"), "utf8"),
    ]);

    expect(adaptiveIntent).not.toContain("TEMPORAL_FACT_PATTERNS");
    expect(adaptiveIntent).not.toContain("CODING_PATTERNS");
    expect(adaptiveIntent).not.toContain("DEEP_REASONING_PATTERNS");
    expect(executionPlanner).not.toContain("isReasoningText");
    expect(executionPlanner).not.toContain("temporalFactMatch");
    expect(executionPlanner).not.toContain("hasQuestionOrFactRequest");
    expect(modeService).not.toContain("Auto classification");
    expect(modeService).not.toContain("resolvedTurnMode: \"coder\"");
    expect(modeService).not.toContain("resolvedTurnMode: \"math\"");
    expect(modeService).not.toContain("resolvedTurnMode: \"deep_research\"");
  });
});
