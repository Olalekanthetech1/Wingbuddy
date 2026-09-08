import { describe, expect, it, vi } from "vitest";
import { AutonomyDecisionService } from "../src/services/autonomy-decision.service";

describe("AutonomyDecisionService", () => {
  it("uses the real model response rather than local keyword heuristics", async () => {
    const generateStructured = vi.fn().mockResolvedValue(
      JSON.stringify({
        route: "direct",
        confidence: 0.97,
        rationale: "The user is requesting a creative response with no durable execution requirement.",
        executionReasons: [],
      }),
    );
    const service = new AutonomyDecisionService(generateStructured);

    const decision = await service.decide({
      userMessage: "Tell me a story I can learn from and make the lesson deep.",
      history: [{ role: "model", content: "I can help with stories." }],
      effectiveMode: "creative",
    });

    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(decision.route).toBe("direct");
    expect(decision.confidence).toBeCloseTo(0.97);
  });

  it("preserves autonomous routing when the model identifies durable multi-step work", async () => {
    const generateStructured = vi.fn().mockResolvedValue(
      JSON.stringify({
        route: "autonomous",
        confidence: 0.94,
        rationale: "The request requires research, comparison, verification, and a durable report artifact.",
        executionReasons: ["multiple dependent actions", "external information", "verification", "artifact creation"],
      }),
    );
    const service = new AutonomyDecisionService(generateStructured);

    const decision = await service.decide({
      userMessage: "Research the history of AI, compare major milestones, verify the sources, and create a report.",
      history: [],
      effectiveMode: "deep_research",
      capabilities: ["web_research", "source_verification"],
    });

    expect(decision.route).toBe("autonomous");
    expect(decision.executionReasons).toContain("verification");
  });

  it("accepts fenced JSON returned by the model", async () => {
    const generateStructured = vi.fn().mockResolvedValue(
      "```json\n{\"route\":\"clarify\",\"confidence\":0.81,\"rationale\":\"Two materially different actions are possible.\",\"executionReasons\":[]}\n```",
    );
    const service = new AutonomyDecisionService(generateStructured);

    const decision = await service.decide({ userMessage: "Do that one." });
    expect(decision.route).toBe("clarify");
  });

  it("fails open to the existing planner path when the classifier is unavailable", async () => {
    const generateStructured = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const service = new AutonomyDecisionService(generateStructured);

    const decision = await service.decide({ userMessage: "Research this topic." });
    expect(decision.route).toBe("fallback");
    expect(decision.confidence).toBe(0);
  });

  it("clamps invalid confidence values instead of trusting model output blindly", async () => {
    const generateStructured = vi.fn().mockResolvedValue(
      JSON.stringify({
        route: "direct",
        confidence: 9,
        rationale: "Direct response is sufficient.",
        executionReasons: [],
      }),
    );
    const service = new AutonomyDecisionService(generateStructured);

    const decision = await service.decide({ userMessage: "Explain recursion." });
    expect(decision.confidence).toBe(1);
  });
});
