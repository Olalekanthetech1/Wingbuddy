import { describe, expect, it } from "vitest";
import { conversationIntelligenceService } from "../src/services/conversation-intelligence.service";

describe("ConversationIntelligenceService", () => {
  it("resolves 'this story' to the immediately preceding assistant artifact", () => {
    const result = conversationIntelligenceService.resolve(
      "So what is the lesson in this story?",
      [
        { role: "user", content: "Tell me another story" },
        { role: "assistant", content: "The Falcon and the Branch\n\nThe lesson..." },
      ],
    );

    expect(result.isFollowUp).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.referenceType).toBe("artifact");
    expect(result.targetExcerpt).toContain("The Falcon and the Branch");
  });

  it("resolves continuation requests without requiring a new task", () => {
    const result = conversationIntelligenceService.resolve(
      "Continue",
      [
        { role: "user", content: "Write the beginning of a story" },
        { role: "assistant", content: "Once upon a time..." },
      ],
    );

    expect(result.isFollowUp).toBe(true);
    expect(result.referenceType).toBe("continuation");
    expect(result.targetExcerpt).toContain("Once upon a time");
  });

  it("treats an unrelated new request as a new conversational turn", () => {
    const result = conversationIntelligenceService.resolve(
      "What is PostgreSQL?",
      [
        { role: "user", content: "Tell me a story" },
        { role: "assistant", content: "A story..." },
      ],
    );

    expect(result.isFollowUp).toBe(false);
    expect(result.referenceType).toBe("none");
  });

  it("does not invent a target when no history exists", () => {
    const result = conversationIntelligenceService.resolve("What is the lesson in this story?", []);
    expect(result.isFollowUp).toBe(false);
    expect(result.targetExcerpt).toBeUndefined();
  });
});
