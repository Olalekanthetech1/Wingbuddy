import { describe, expect, it } from "vitest";
import { conversationScopeKey } from "../src/services/conversation-scope";

describe("conversation isolation", () => {
  it("creates distinct scopes for different Telegram users and chats", () => {
    expect(conversationScopeKey(100, 200)).not.toBe(conversationScopeKey(101, 200));
    expect(conversationScopeKey(100, 200)).not.toBe(conversationScopeKey(100, 201));
  });
});