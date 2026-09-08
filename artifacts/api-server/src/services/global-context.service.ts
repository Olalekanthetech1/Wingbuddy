import {
  chatDatabaseService,
  type UserMemoryRecord,
} from "@workspace/db";
import { ConversationService, type TelegramUserProfile } from "./conversation.service";
import { PERSONALITIES, type PersonalityKey } from "../config/personality";
import { MODES, type ModeKey } from "../config/mode";
import { cosineSimilarity, type GeminiService } from "../gemini/gemini.service";
import { AdaptiveEngineService } from "./adaptive-engine.service";

export interface UserGlobalContext {
  telegramUserId: number;
  chatId: number;
  conversationId: number;
  userProfile: {
    name?: string;
    username?: string;
    personality: PersonalityKey;
    personalityLabel: string;
    personalityInstruction: string;
    mode: ModeKey;
    modeLabel: string;
    modeInstruction: string;
  };
  memories: UserMemoryRecord[];
  sessionSummaries: Array<{ id: number; summary: string; updatedAt: Date }>;
  semanticRecall?: Array<{ role: string; content: string }>;
  recentHistory: Array<{ role: "user" | "model"; content: string }>;
  promptInstruction: string;
}

/**
 * Global Context Layer:
 * Automatically associates incoming messages with the user's ID in PostgreSQL,
 * synchronizes identity, and aggregates long-term profile memories, episodic session summaries,
 * semantic vector memory recall, and working conversation history into an enriched context snapshot
 * before every Gemini completion.
 */
export class GlobalContextService {
  constructor(private readonly conversations: ConversationService) {}

  /**
   * Queries and builds the complete global context for a user before calling Gemini.
   * Runs transparently without requiring the user to invoke any slash commands.
   */
  async getContextForCompletion(params: {
    telegramUserId: number;
    chatId: number;
    userProfile?: TelegramUserProfile;
    maxHistoryMessages?: number;
    message?: string;
    geminiService?: GeminiService;
  }): Promise<UserGlobalContext> {
    const {
      telegramUserId,
      chatId,
      userProfile,
      maxHistoryMessages = 20,
      message,
      geminiService,
    } = params;

    // 1. Automatically associate and sync the user profile
    if (userProfile) {
      await this.conversations.upsertUser(userProfile);
    }

    // 2. Automatically associate with the conversation session
    const conversationId = await this.conversations.getOrCreateConversation(
      telegramUserId,
      chatId,
    );

    // 3. Query user settings, memories, and episodic summaries
    const [personality, mode, allMemories, sessionSummaries] =
      await Promise.all([
        this.conversations.getUserPersonality(telegramUserId),
        this.conversations.getUserMode(telegramUserId),
        chatDatabaseService.getUserMemories(telegramUserId),
        chatDatabaseService.getRecentSessionSummaries(telegramUserId, 3),
      ]);

    // 4. Native Vector Search & Hybrid RAG Retrieval across long-term memories and past dialogue
    let memories = allMemories;
    let semanticRecall: Array<{ role: string; content: string }> = [];

    if (message && message.trim().length > 3) {
      try {
        let queryVec: number[] = [];
        if (geminiService && typeof geminiService.embedText === "function") {
          queryVec = await geminiService.embedText(message);
        }

        // 4a. Vector similarity search on memories via PostgreSQL pgvector
        if (queryVec.length > 0) {
          const vectorMemories = await chatDatabaseService.searchSimilarMemories(
            telegramUserId,
            queryVec,
            5,
            0.45,
          );
          if (vectorMemories.length > 0) {
            // Merge top vector memories with other stored memories, deduplicating by key
            const vectorKeySet = new Set(vectorMemories.map((m) => m.key));
            const remaining = allMemories.filter((m) => !vectorKeySet.has(m.key));
            memories = [...vectorMemories, ...remaining];
          }
        }

        // 4b. Semantic Dialogue Recall across past conversations
        const historicalCandidates = await chatDatabaseService.searchHistoricalDialogue(
          telegramUserId,
          message,
          conversationId,
          5,
        );

        if (historicalCandidates.length > 0) {
          if (queryVec.length > 0) {
            const scored = await Promise.all(
              historicalCandidates.map(async (cand) => {
                const candVec = await geminiService!.embedText(cand.content);
                const score = candVec.length > 0 ? cosineSimilarity(queryVec, candVec) : 0.5;
                return { cand, score };
              }),
            );
            scored.sort((a, b) => b.score - a.score);
            semanticRecall = scored.slice(0, 3).map((s) => ({
              role: s.cand.role,
              content: s.cand.content,
            }));
          } else {
            semanticRecall = historicalCandidates.slice(0, 3).map((c) => ({
              role: c.role,
              content: c.content,
            }));
          }
        }
      } catch {
        // Fallback gracefully without breaking completion pipeline
      }
    }

    // 5. Dynamically compute the adaptive history window based on mode, prompt length, and memory density
    const adaptiveLimit = maxHistoryMessages !== undefined && maxHistoryMessages !== 20
      ? maxHistoryMessages
      : AdaptiveEngineService.computeAdaptiveHistoryLimit({
          mode,
          currentMessage: message,
          memoriesCount: memories.length,
        });

    const recentMessages = await this.conversations.getRecentMessages(
      conversationId,
      adaptiveLimit,
    );

    const personalityConfig = PERSONALITIES[personality] || PERSONALITIES.playful;
    const modeConfig = MODES[mode] || MODES.general;

    const fullName = [userProfile?.firstName, userProfile?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    const displayName = fullName || userProfile?.username || undefined;

    // 5. Format the unified Global Context block
    const promptInstruction = chatDatabaseService.formatGlobalContextForPrompt({
      userName: displayName,
      personalityLabel: personalityConfig.label,
      modeLabel: modeConfig.label,
      memories,
      sessionSummaries,
      semanticRecall,
    });

    const recentHistory = recentMessages.map((item) => ({
      role: (item.role === "model" ? "model" : "user") as "user" | "model",
      content: item.content,
    }));

    return {
      telegramUserId,
      chatId,
      conversationId,
      userProfile: {
        name: displayName,
        username: userProfile?.username,
        personality,
        personalityLabel: personalityConfig.label,
        personalityInstruction: personalityConfig.instruction,
        mode,
        modeLabel: modeConfig.label,
        modeInstruction: modeConfig.instruction,
      },
      memories,
      sessionSummaries,
      semanticRecall,
      recentHistory,
      promptInstruction,
    };
  }
}
