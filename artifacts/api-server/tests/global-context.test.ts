import { describe, expect, it, vi } from "vitest";
import { GlobalContextService } from "../src/services/global-context.service";
import type { ConversationService } from "../src/services/conversation.service";

describe("GlobalContextService", () => {
  it("automatically aggregates user profile, long-term memory, and session history", async () => {
    const mockConversations: Partial<ConversationService> = {
      upsertUser: vi.fn().mockResolvedValue(undefined),
      getOrCreateConversation: vi.fn().mockResolvedValue(42),
      getUserPersonality: vi.fn().mockResolvedValue("playful"),
      getUserMode: vi.fn().mockResolvedValue("coding"),
      getRecentMessages: vi.fn().mockResolvedValue([
        { id: 1, conversationId: 42, role: "user", content: "Hello", createdAt: new Date() },
        { id: 2, conversationId: 42, role: "model", content: "Hi! How can I help?", createdAt: new Date() },
      ]),
    };

    const service = new GlobalContextService(mockConversations as ConversationService);

    const context = await service.getContextForCompletion({
      telegramUserId: 999111,
      chatId: 888222,
      userProfile: {
        id: 999111,
        firstName: "Alex",
        username: "alexdev",
      },
      maxHistoryMessages: 10,
    });

    expect(mockConversations.upsertUser).toHaveBeenCalledWith({
      id: 999111,
      firstName: "Alex",
      username: "alexdev",
    });
    expect(mockConversations.getOrCreateConversation).toHaveBeenCalledWith(999111, 888222);
    expect(context.telegramUserId).toBe(999111);
    expect(context.chatId).toBe(888222);
    expect(context.conversationId).toBe(42);
    expect(context.userProfile.name).toBe("Alex");
    expect(context.userProfile.personality).toBe("playful");
    expect(context.userProfile.mode).toBe("coding");
    expect(context.recentHistory).toHaveLength(2);
    expect(context.recentHistory[0].content).toBe("Hello");
    expect(context.recentHistory[1].content).toBe("Hi! How can I help?");
  });
});
