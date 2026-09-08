import { describe, expect, it, vi, afterEach } from "vitest";
import { chatDatabaseService, type UserMemoryRecord } from "@workspace/db";
import { GlobalContextService } from "../src/services/global-context.service";
import { ContextManagerService } from "../src/services/context-manager.service";

const baseMemory = (overrides: Partial<UserMemoryRecord> = {}): UserMemoryRecord => ({
  id: 1,
  telegramUserId: 1001,
  key: "learning_style",
  content: "Explain first, then ask questions.",
  category: "user_preference",
  type: "interaction_preference",
  structuredValue: null,
  confidence: "high",
  importance: "medium",
  status: "active",
  embeddingJson: null,
  sourceSessionId: null,
  sourceMessageId: null,
  sourceConversationId: null,
  expiresAt: null,
  lastAccessedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("memory relevance boundary", () => {
  it("passes only semantically retrieved memories to GlobalContextService", async () => {
    const irrelevant = baseMemory({
      id: 2,
      key: "trading_project",
      content: "User is building a trading bot.",
      type: "project_context",
      category: "project_context",
    });
    const relevant = baseMemory();

    vi.spyOn(chatDatabaseService, "getUserMemories").mockResolvedValue([
      irrelevant,
      relevant,
    ]);
    vi.spyOn(chatDatabaseService, "searchSimilarMemories").mockResolvedValue([relevant]);
    vi.spyOn(chatDatabaseService, "getRecentSessionSummaries").mockResolvedValue([]);
    vi.spyOn(chatDatabaseService, "searchHistoricalDialogue").mockResolvedValue([]);
    vi.spyOn(chatDatabaseService, "formatGlobalContextForPrompt").mockImplementation((options) =>
      options.memories.map((m) => m.content).join("\n"),
    );

    const conversations = {
      upsertUser: vi.fn().mockResolvedValue(undefined),
      getOrCreateConversation: vi.fn().mockResolvedValue(1),
      getUserPersonality: vi.fn().mockResolvedValue("playful"),
      getUserMode: vi.fn().mockResolvedValue("general"),
      getRecentMessages: vi.fn().mockResolvedValue([]),
    } as any;

    const service = new GlobalContextService(conversations);
    const result = await service.getContextForCompletion({
      telegramUserId: 1001,
      chatId: 1001,
      message: "What is my learning style?",
      geminiService: { embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) } as any,
    });

    expect(result.memories).toEqual([relevant]);
    expect(result.memories).not.toContainEqual(irrelevant);
    expect(result.promptInstruction).toContain("Explain first, then ask questions.");
    expect(result.promptInstruction).toContain("MEMORY SILENCE POLICY");
  });

  it("fails closed instead of loading all memories when embedding retrieval fails", async () => {
    const irrelevant = baseMemory({
      id: 3,
      key: "unrelated_fact",
      content: "An unrelated remembered fact.",
      type: "user_fact",
      category: "user_fact",
    });

    vi.spyOn(chatDatabaseService, "getUserMemories").mockResolvedValue([irrelevant]);
    vi.spyOn(chatDatabaseService, "getRecentSessionSummaries").mockResolvedValue([]);
    vi.spyOn(chatDatabaseService, "searchHistoricalDialogue").mockResolvedValue([]);

    const conversations = {
      upsertUser: vi.fn().mockResolvedValue(undefined),
      getOrCreateConversation: vi.fn().mockResolvedValue(1),
      getUserPersonality: vi.fn().mockResolvedValue("playful"),
      getUserMode: vi.fn().mockResolvedValue("general"),
      getRecentMessages: vi.fn().mockResolvedValue([]),
    } as any;

    const service = new GlobalContextService(conversations);
    const result = await service.getContextForCompletion({
      telegramUserId: 1001,
      chatId: 1001,
      message: "Explain photosynthesis.",
      geminiService: { embedText: vi.fn().mockRejectedValue(new Error("embedding unavailable")) } as any,
    });

    expect(result.memories).toEqual([]);
    expect(result.promptInstruction).not.toContain("An unrelated remembered fact.");
  });

  it("does not reload the full memory corpus when ContextManager receives an explicit empty recall set", async () => {
    const getUserMemories = vi.spyOn(chatDatabaseService, "getUserMemories");
    const getRecentSessionSummaries = vi
      .spyOn(chatDatabaseService, "getLatestSummaryForConversation")
      .mockResolvedValue(null);

    const service = new ContextManagerService();
    const result = await service.assembleContext({
      telegramUserId: 1001,
      userMessage: "What is photosynthesis?",
      effectiveModeInstruction: "Answer normally.",
      relevantMemories: [],
      history: [],
    });

    expect(getUserMemories).not.toHaveBeenCalled();
    expect(getRecentSessionSummaries).not.toHaveBeenCalled();
    expect(result.formattedMemories).toBe("");
    expect(result.effectiveSystemPrompt).toContain("MEMORY SILENCE POLICY");
  });
});
