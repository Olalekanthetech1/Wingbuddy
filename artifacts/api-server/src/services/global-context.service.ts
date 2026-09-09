import {
  chatDatabaseService,
  type UserMemoryRecord,
} from "@workspace/db";
import { ConversationService, type TelegramUserProfile } from "./conversation.service";
import { PERSONALITIES, type PersonalityKey } from "../config/personality";
import { MODES, type ModeKey } from "../config/mode";
import { cosineSimilarity, type GeminiService } from "../gemini/gemini.service";
import { AdaptiveEngineService } from "./adaptive-engine.service";
import { TemporalContextService } from "./temporal-context.service";

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
  temporalContext: ReturnType<typeof TemporalContextService.resolve>;
}

/**
 * Global Context Layer:
 * Automatically associates incoming messages with the user's ID in PostgreSQL,
 * synchronizes identity, and aggregates only relevant long-term profile memories,
 * episodic session summaries, semantic vector memory recall, and working conversation history
 * into an enriched context snapshot before every Gemini completion.
 */
export class GlobalContextService {
  constructor(private readonly conversations: ConversationService) {}

  /**
   * Queries and builds the complete global context for a user before calling Gemini.
   * Long-term memory is recall-oriented: only memories relevant to the current request are
   * passed to the model. Persistent memories remain stored and are never deleted by relevance filtering.
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

    // 4. Recall-oriented long-term memory retrieval.
    // IMPORTANT: never merge vector matches back with the full memory corpus.
    // Relevance controls what is exposed to the model for this turn; storage is untouched.
    let memories: UserMemoryRecord[] = [];
    let memoryRecallSource: "vector" | "lexical" | "none" = "none";
    const query = message?.trim() ?? "";
    let semanticRecall: Array<{ role: string; content: string }> = [];

    if (query.length > 3) {
      try {
        let queryVec: number[] = [];
        if (geminiService && typeof geminiService.embedText === "function") {
          queryVec = await geminiService.embedText(query);
        }

        // Use the database's adaptive threshold and limit. Only matches are exposed to Gemini.
        if (queryVec.length > 0) {
          memories = await chatDatabaseService.searchSimilarMemories(
            telegramUserId,
            queryVec,
          );
          memoryRecallSource = memories.length > 0 ? "vector" : "none";
        } else {
          memories = await chatDatabaseService.searchMemories(telegramUserId, query);
          memoryRecallSource = memories.length > 0 ? "lexical" : "none";
        }

        // Semantic dialogue recall across past conversations
        const historicalCandidates = await chatDatabaseService.searchHistoricalDialogue(
          telegramUserId,
          query,
          conversationId,
          5,
        );

        if (historicalCandidates.length > 0) {
          if (queryVec.length > 0 && geminiService) {
            const scored = await Promise.all(
              historicalCandidates.map(async (cand) => {
                const candVec = await geminiService.embedText(cand.content);
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
        // Fail closed: retrieval failures must not expose the full persistent memory corpus.
        memories = [];
        memoryRecallSource = "none";
      }
    }

    // Keep the variable referenced for observability without exposing internal recall mechanics to users.
    void allMemories;
    void memoryRecallSource;

    // 5. Dynamically compute the adaptive history window based on mode, prompt length, and recalled-memory density
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

    // 6. Resolve deterministic temporal context locally. The LLM generates the natural
    // wording; this layer only supplies the trustworthy local date/time and identity facts.
    const temporalContext = TemporalContextService.resolve();

    // 7. Format the unified Global Context block using ONLY the recalled memories for this turn.
    const promptInstructionBase = chatDatabaseService.formatGlobalContextForPrompt({
      userName: displayName,
      personalityLabel: personalityConfig.label,
      modeLabel: modeConfig.label,
      memories,
      sessionSummaries,
      semanticRecall,
    });

    const identityInstruction = [
      "[IDENTITY CONTEXT]",
      displayName ? `Preferred/display name: ${displayName}` : "No reliable user name is available.",
      "Use the user's name naturally when it improves warmth, clarity, or personalization. Never invent or repeatedly insert a name.",
    ].join("\n");

    const temporalInstruction = TemporalContextService.buildPromptInstruction(temporalContext);

    const promptInstruction = [
      promptInstructionBase,
      identityInstruction,
      temporalInstruction,
      "[MEMORY SILENCE POLICY] Persistent memory is background context, not response content. Never mention, enumerate, expose, or narrate stored memories, memory keys, personalization, or the fact that something was remembered unless the user explicitly asks what you remember, asks to inspect/manage memories, or otherwise makes memory itself the subject of the request.",
    ]
      .filter(Boolean)
      .join("\n\n");

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
      temporalContext,
    };
  }
}
