import { describe, expect, it } from "vitest";
import { conversationIntelligenceService } from "../src/services/conversation-intelligence.service";

describe("ConversationIntelligenceService semantic state", () => {
  const history = [
    { role: "user", content: "Tell me a story I can learn from." },
    {
      role: "assistant",
      content:
        "The Two Potters\n\nTwo potters faced the same setback. One treated it as proof of failure; the other used it to improve his craft.\n\n💡 The Lesson\nProgress often begins when you stop treating mistakes as verdicts.",
    },
  ];

  it("maps a lesson request to extract_lesson instead of punchline", async () => {
    const result = await conversationIntelligenceService.analyzeSemanticState(
      "What's the lesson in the story you just told?",
      history,
      async () =>
        JSON.stringify({
          isFollowUp: true,
          confidence: 0.99,
          currentTopic: "learning from setbacks",
          activeArtifact: {
            historyIndex: 1,
            type: "story",
            title: "The Two Potters",
            purpose: "Teach a lesson about learning from setbacks",
            topic: "learning from setbacks",
            components: ["story", "lesson"],
            excerpt: "The Two Potters",
          },
          referencedArtifacts: [],
          operation: "extract_lesson",
          operationTarget: "lesson component",
          requestedTransformation: "",
          unresolvedReference: "",
          rationale: "The user asks for the lesson of the immediately preceding story.",
        }),
    );

    expect(result.operation).toBe("extract_lesson");
    expect(result.activeArtifact?.historyIndex).toBe(1);
    expect(result.activeArtifact?.type).toBe("story");
    expect(result.currentTopic).toBe("learning from setbacks");
  });

  it("maps a transformation request to the referenced artifact", async () => {
    const result = await conversationIntelligenceService.analyzeSemanticState(
      "Make it deeper.",
      history,
      async () =>
        JSON.stringify({
          isFollowUp: true,
          confidence: 0.96,
          currentTopic: "learning from setbacks",
          activeArtifact: {
            historyIndex: 1,
            type: "story",
            title: "The Two Potters",
            purpose: "Teach a lesson about learning from setbacks",
            topic: "learning from setbacks",
            components: ["story", "lesson"],
            excerpt: "The Two Potters",
          },
          referencedArtifacts: [],
          operation: "deepen",
          operationTarget: "lesson component",
          requestedTransformation: "Make the lesson deeper and more reflective.",
          unresolvedReference: "",
          rationale: "'It' refers to the current story or its lesson in context.",
        }),
    );

    expect(result.operation).toBe("deepen");
    expect(result.requestedTransformation).toContain("deeper");
  });

  it("can resolve multiple artifacts for comparison", async () => {
    const comparisonHistory = [
      ...history,
      { role: "user", content: "Tell me another story with a different lesson." },
      { role: "assistant", content: "The Fisherman and the Clock\n\nLesson: Value time, not appearances." },
    ];

    const result = await conversationIntelligenceService.analyzeSemanticState(
      "Compare the two.",
      comparisonHistory,
      async () =>
        JSON.stringify({
          isFollowUp: true,
          confidence: 0.94,
          currentTopic: "contrasting lessons",
          activeArtifact: {
            historyIndex: 3,
            type: "story",
            title: "The Fisherman and the Clock",
            purpose: "Teach a lesson about valuing time",
            topic: "valuing time",
            components: ["story", "lesson"],
            excerpt: "The Fisherman and the Clock",
          },
          referencedArtifacts: [
            {
              historyIndex: 1,
              type: "story",
              title: "The Two Potters",
              purpose: "Teach a lesson about learning from setbacks",
              topic: "learning from setbacks",
              components: ["story", "lesson"],
              excerpt: "The Two Potters",
            },
          ],
          operation: "compare",
          operationTarget: "both stories",
          requestedTransformation: "",
          unresolvedReference: "",
          rationale: "'The two' resolves to the two recent story artifacts.",
        }),
    );

    expect(result.operation).toBe("compare");
    expect(result.activeArtifact?.title).toBe("The Fisherman and the Clock");
    expect(result.referencedArtifacts).toHaveLength(1);
    expect(result.referencedArtifacts[0].title).toBe("The Two Potters");
  });

  it("rejects model-invented artifact indices", async () => {
    const result = await conversationIntelligenceService.analyzeSemanticState(
      "What did you mean by that?",
      history,
      async () =>
        JSON.stringify({
          isFollowUp: true,
          confidence: 0.8,
          currentTopic: "unknown",
          activeArtifact: { historyIndex: 999, type: "story", excerpt: "fabricated" },
          referencedArtifacts: [],
          operation: "clarify_reference",
          unresolvedReference: "that",
          rationale: "The target index is not present in the supplied history.",
        }),
    );

    expect(result.activeArtifact).toBeUndefined();
    expect(result.operation).toBe("clarify_reference");
    expect(result.unresolvedReference).toBe("that");
  });

  it("falls back safely when the semantic model fails", async () => {
    const result = await conversationIntelligenceService.analyzeSemanticState(
      "Continue",
      history,
      async () => {
        throw new Error("provider unavailable");
      },
    );

    expect(result.isFollowUp).toBe(true);
    expect(result.operation).toBe("continue");
    expect(result.activeArtifact?.historyIndex).toBe(1);
  });
});
