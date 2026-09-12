import { describe, expect, it, vi } from "vitest";
import { cosineSimilarity, type GeminiService } from "../src/gemini/gemini.service";
import { GlobalContextService } from "../src/services/global-context.service";
import type { ConversationService } from "../src/services/conversation.service";
import { chatDatabaseService } from "@workspace/db";

describe("Semantic Vector Memory & Hybrid RAG", () => {
  it("calculates cosine similarity accurately between vectors", () => {
    // Identical vectors -> 1
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1.0);
    // Orthogonal vectors -> 0
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
    // Opposite vectors -> -1
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
    // Handles empty or mismatched vectors safely
    expect(cosineSimilarity([], [1, 0])).toBe(0);
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });

  it("retrieves and ranks past dialogue using dense vector embeddings", async () => {
    const mockConversations: Partial<ConversationService> = {
      upsertUser: vi.fn().mockResolvedValue(undefined),
      getOrCreateConversation: vi.fn().mockResolvedValue(10),
      getUserPersonality: vi.fn().mockResolvedValue("warm"),
      getUserMode: vi.fn().mockResolvedValue("general"),
      getRecentMessages: vi.fn().mockResolvedValue([]),
    };

    // Mock chatDatabaseService historical dialogue candidates
    vi.spyOn(chatDatabaseService, "searchHistoricalDialogue").mockResolvedValue([
      {
        conversationId: 5,
        role: "model",
        content: "We chose PostgreSQL with Prisma and vector embeddings for semantic recall.",
        createdAt: new Date(),
      },
      {
        conversationId: 3,
        role: "user",
        content: "What's the weather like today?",
        createdAt: new Date(),
      },
    ]);

    // Mock GeminiService embedText
    const mockGemini: Partial<GeminiService> = {
      embedText: vi.fn().mockImplementation(async (text: string) => {
        if (text.includes("database") || text.includes("PostgreSQL")) {
          return [0.9, 0.1, 0.0];
        }
        return [0.0, 0.1, 0.9];
      }),
      generateReply: vi.fn().mockResolvedValue(JSON.stringify({
        intent: "general",
        effectiveMode: "general",
        requiredCapabilities: [],
        complexity: "simple",
      })),
    };

    const service = new GlobalContextService(mockConversations as ConversationService);

    const context = await service.getContextForCompletion({
      telegramUserId: 12345,
      chatId: 67890,
      message: "What database architecture did we choose previously?",
      geminiService: mockGemini as GeminiService,
    });

    expect(context.semanticRecall).toBeDefined();
    expect(context.semanticRecall?.length).toBeGreaterThan(0);
    // The PostgreSQL architecture message should be ranked highest due to high cosine similarity
    expect(context.semanticRecall?.[0].content).toContain("PostgreSQL with Prisma");
    expect(context.promptInstruction).toContain("[SEMANTICALLY RECALLED PAST CONTEXT (VECTOR / HYBRID RAG)]");
  });
});
