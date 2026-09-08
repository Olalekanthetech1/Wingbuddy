import { describe, expect, it } from "vitest";
import { chatDatabaseService } from "@workspace/db";

describe("ChatDatabaseService", () => {
  it("formats empty memories as an empty string", () => {
    const formatted = chatDatabaseService.formatMemoriesForPrompt([]);
    expect(formatted).toBe("");
  });

  it("formats user long-term memories into structured prompt blocks", () => {
    const mockMemories = [
      {
        id: 1,
        telegramUserId: 12345,
        key: "coding_preference",
        content: "Prefers TypeScript with strict types and clean functional architecture",
        category: "preference",
        sourceSessionId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 2,
        telegramUserId: 12345,
        key: "user_role",
        content: "Lead software engineer",
        category: "fact",
        sourceSessionId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const formatted = chatDatabaseService.formatMemoriesForPrompt(mockMemories);
    expect(formatted).toContain("[USER LONG-TERM MEMORY & KNOWN PREFERENCES]");
    expect(formatted).toContain("- [preference] coding_preference: Prefers TypeScript");
    expect(formatted).toContain("- [fact] user_role: Lead software engineer");
    expect(formatted).toContain("Use this long-term context seamlessly");
  });
});
