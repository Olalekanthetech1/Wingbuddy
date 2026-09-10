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
import { SemanticInteractionResolverService } from "./semantic-interaction-resolver.service";
import type { SemanticInteractionDecision } from "./semantic-interaction-cache.service";

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
  semanticInteraction?: SemanticInteractionDecision;
}

export class GlobalContextService {
  constructor(private readonly conversations: ConversationService) {}

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
      maxHistoryMessages,
      message,
      geminiService,
    } = params;

    if (userProfile) await this.conversations.upsertUser(userProfile);
    const conversationId = await this.conversations.getOrCreateConversation(telegramUserId, chatId);

    const [personality, mode, allMemories, sessionSummaries] = await Promise.all([
      this.conversations.getUserPersonality(telegramUserId),
      this.conversations.getUserMode(telegramUserId),
      chatDatabaseService.getUserMemories(telegramUserId),
      chatDatabaseService.getRecentSessionSummaries(telegramUserId, 3),
    ]);

    const query = message?.trim() ?? "";
    let memories: UserMemoryRecord[] = [];
    let semanticRecall: Array<{ role: string; content: string }> = [];
    let memoryRecallSource: "vector" | "lexical" | "none" = "none";

    if (query.length > 3) {
      try {
        let queryVec: number[] = [];
        if (geminiService && typeof geminiService.embedText === "function") {
          queryVec = await geminiService.embedText(query);
        }
        if (queryVec.length > 0) {
          memories = await chatDatabaseService.searchSimilarMemories(telegramUserId, queryVec);
          memoryRecallSource = memories.length > 0 ? "vector" : "none";
        } else {
          memories = await chatDatabaseService.searchMemories(telegramUserId, query);
          memoryRecallSource = memories.length > 0 ? "lexical" : "none";
        }
        const historicalCandidates = await chatDatabaseService.searchHistoricalDialogue(telegramUserId, query, conversationId, 5);
        if (historicalCandidates.length > 0) {
          if (queryVec.length > 0 && geminiService) {
            const scored = await Promise.all(historicalCandidates.map(async (cand) => {
              const candVec = await geminiService.embedText(cand.content);
              const score = candVec.length > 0 ? cosineSimilarity(queryVec, candVec) : 0.5;
              return { cand, score };
            }));
            scored.sort((a, b) => b.score - a.score);
            semanticRecall = scored.slice(0, 3).map(({ cand }) => ({ role: cand.role, content: cand.content }));
          } else {
            semanticRecall = historicalCandidates.slice(0, 3).map((c) => ({ role: c.role, content: c.content }));
          }
        }
      } catch {
        memories = [];
        memoryRecallSource = "none";
      }
    }

    void allMemories;
    void memoryRecallSource;

    const adaptiveLimit = maxHistoryMessages !== undefined
      ? maxHistoryMessages
      : AdaptiveEngineService.computeAdaptiveHistoryLimit({ mode, currentMessage: message, memoriesCount: memories.length });
    const recentMessages = await this.conversations.getRecentMessages(conversationId, adaptiveLimit);
    const recentHistory = recentMessages.map((item) => ({
      role: (item.role === "model" ? "model" : "user") as "user" | "model",
      content: item.content,
    }));

    // Prime exactly one semantic decision for this request. Downstream mode/intent/planning
    // consumers read the same short-lived fingerprinted result rather than reclassifying.
    let semanticInteraction: SemanticInteractionDecision | undefined;
    if (query && geminiService) {
      semanticInteraction = await SemanticInteractionResolverService.resolve({
        text: query,
        persistentMode: mode,
        history: recentHistory,
        gemini: geminiService,
      });
    }

    const personalityConfig = PERSONALITIES[personality] || PERSONALITIES.playful;
    const modeConfig = MODES[mode] || MODES.general;
    const fullName = [userProfile?.firstName, userProfile?.lastName].filter(Boolean).join(" ").trim();
    const displayName = fullName || userProfile?.username || undefined;
    const temporalContext = TemporalContextService.resolve();

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
    const greetingInstruction = semanticInteraction?.isGreeting
      ? [
          "[GREETING BEHAVIOR]",
          "Treat this turn as live conversation, not a command to execute.",
          "Respond warmly and naturally in one or two sentences, then create a natural opening for the user to continue the conversation.",
          "Use available context or the user's name only when it genuinely improves the interaction.",
          "Do not reply with only a bare greeting, a name, or a generic acknowledgement.",
          "Do not invent actions, tasks, memories, or capabilities the user did not request.",
        ].join("\n")
      : undefined;
    const promptInstruction = [
      promptInstructionBase,
      identityInstruction,
      temporalInstruction,
      greetingInstruction,
      "[MEMORY SILENCE POLICY] Persistent memory is background context, not response content. Never mention, enumerate, expose, or narrate stored memories, memory keys, personalization, or the fact that something was remembered unless the user explicitly asks what you remember, asks to inspect/manage memories, or otherwise makes memory itself the subject of the request.",
    ].filter(Boolean).join("\n\n");

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
      semanticInteraction,
    };
  }
}
