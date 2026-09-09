import { taskService } from "./task.service";
import { instructionResolutionService } from "./instruction-resolution.service";
import {
  conversationIntelligenceService,
  type ConversationSemanticState,
} from "./conversation-intelligence.service";
import { GeminiService } from "../gemini/gemini.service";
import { getConfig } from "../config/env";
import {
  chatDatabaseService,
  type AgentTaskRecord,
  type AgentTaskStepRecord,
  type UserMemoryRecord,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { semanticInteractionCache } from "./semantic-interaction-cache.service";

export interface AssembledContext {
  effectiveSystemPrompt: string;
  formattedMemories: string;
  formattedTaskContext: string;
  conversationSummary: string;
  history: Array<{ role: string; content: string }>;
  tokenCountEstimate: number;
  isTruncated: boolean;
}

export class ContextManagerService {
  private static readonly DEFAULT_MAX_CHAR_BUDGET = 120_000;
  private gemini?: GeminiService;

  private getGemini(): GeminiService {
    if (!this.gemini) {
      const config = getConfig();
      this.gemini = new GeminiService(config.geminiApiKey, config.geminiModel, config.geminiTimeoutMs);
    }
    return this.gemini;
  }

  private async resolveRelevantMemories(
    telegramUserId: number,
    userMessage: string,
    provided?: UserMemoryRecord[],
  ): Promise<UserMemoryRecord[]> {
    if (provided !== undefined) return provided;
    const query = userMessage.trim();
    if (query.length <= 3) return [];

    try {
      const queryVec = await this.getGemini().embedText(query);
      if (queryVec.length > 0) return await chatDatabaseService.searchSimilarMemories(telegramUserId, queryVec);
      return await chatDatabaseService.searchMemories(telegramUserId, query);
    } catch (error) {
      logger.debug?.(
        { telegramUserId, error: error instanceof Error ? error.message : String(error) },
        "Relevant memory retrieval unavailable; continuing without long-term memory for this turn",
      );
      return [];
    }
  }

  async assembleContext(options: {
    telegramUserId: number | bigint;
    conversationId?: number;
    userMessage: string;
    effectiveModeInstruction: string;
    activeTask?: { task: AgentTaskRecord; steps: AgentTaskStepRecord[] } | null;
    relevantMemories?: UserMemoryRecord[];
    history?: Array<{ role: string; content: string }>;
    semanticState?: ConversationSemanticState | null;
    maxCharBudget?: number;
  }): Promise<AssembledContext> {
    const telegramUserId = Number(options.telegramUserId);
    const maxBudget = options.maxCharBudget ?? ContextManagerService.DEFAULT_MAX_CHAR_BUDGET;
    const memories = await this.resolveRelevantMemories(telegramUserId, options.userMessage, options.relevantMemories);
    const formattedMemories = memories.length > 0
      ? `\n\n[RELEVANT LONG-TERM MEMORY]\n${memories.map((m) => `- ${m.content}`).join("\n")}\n\nUse only when relevant. Do not mention the memory system to the user.`
      : "";

    // Task context is explicit: the Telegram request path decides when a tracked task
    // is actually relevant and passes it here. Do not implicitly attach the user's first
    // active task to every unrelated conversation turn.
    const activeTaskData = options.activeTask || null;
    const formattedTaskContext = activeTaskData
      ? taskService.formatTaskForPrompt(activeTaskData.task, activeTaskData.steps)
      : "";

    let conversationSummary = "";
    const sessionSummaries: Array<{ summary: string }> = [];
    if (options.conversationId) {
      const summaryRecord = await chatDatabaseService.getLatestSummaryForConversation(options.conversationId);
      if (summaryRecord) {
        conversationSummary = `\n\n[PAST CONVERSATION SUMMARY]\n${summaryRecord.summary}`;
        sessionSummaries.push({ summary: summaryRecord.summary });
      }
    }

    let rawHistory = options.history || [];
    let isTruncated = false;
    let semanticState = options.semanticState || null;

    if (!semanticState && rawHistory.length > 0 && options.userMessage.trim()) {
      const cachedInteraction = semanticInteractionCache.getLatestForText(options.userMessage);
      const isSimpleCachedTurn = Boolean(
        cachedInteraction &&
        cachedInteraction.complexity === "simple" &&
        cachedInteraction.taskIntent === "NO_TASK" &&
        cachedInteraction.conversationOperation === "new_request" &&
        !cachedInteraction.unresolvedReference &&
        !cachedInteraction.enableSearch &&
        !cachedInteraction.thinkingLevel &&
        !cachedInteraction.isModeSwitch &&
        cachedInteraction.intent !== "image_generation" &&
        cachedInteraction.intent !== "video_generation" &&
        cachedInteraction.intent !== "search_grounding" &&
        cachedInteraction.intent !== "deep_reasoning",
      );

      if (!isSimpleCachedTurn) {
        try {
          semanticState = await conversationIntelligenceService.analyzeSemanticState(
            options.userMessage,
            rawHistory,
            async (history, analysisPrompt) => this.getGemini().generateReply(
              history,
              analysisPrompt,
              "Act as the conversation-state interpreter. Return only the exact JSON object requested.",
            ),
          );
        } catch (error) {
          logger.debug?.(
            { telegramUserId, error: error instanceof Error ? error.message : String(error) },
            "Semantic conversation analysis unavailable; continuing without semantic continuity enrichment",
          );
        }
      }
    }

    const continuity = conversationIntelligenceService.resolve(options.userMessage, rawHistory, semanticState);
    const continuityInstruction = conversationIntelligenceService.buildContextInstruction(continuity);
    const semanticInstruction = semanticState
      ? conversationIntelligenceService.buildSemanticContextInstruction(semanticState)
      : "";

    const calculateLength = (hist: Array<{ role: string; content: string }>, sysPromptLength: number) =>
      sysPromptLength + options.userMessage.length + hist.reduce((sum, h) => sum + h.content.length, 0);

    const resolution = instructionResolutionService.resolvePrecedence({
      effectiveModeInstruction: options.effectiveModeInstruction,
      userMessage: options.userMessage,
      memories,
      activeTask: activeTaskData,
      sessionSummaries,
      semanticRecall: rawHistory.slice(-4).map((h) => ({ role: h.role, content: h.content })),
    });

    let fullSystemPrompt = resolution.effectiveSystemPrompt + conversationSummary;
    if (continuityInstruction) fullSystemPrompt += `\n\n${continuityInstruction}`;
    if (semanticInstruction) fullSystemPrompt += `\n\n${semanticInstruction}`;
    if (formattedMemories) fullSystemPrompt += formattedMemories;
    fullSystemPrompt +=
      "\n\n[MEMORY SILENCE POLICY]\nTreat long-term memory as silent background context. Never say that you remember something, never list stored memories, never reveal memory keys or retrieval details, and never attribute an answer to a stored memory unless the user explicitly asks about memory itself.";

    if (calculateLength(rawHistory, fullSystemPrompt.length) > maxBudget && rawHistory.length > 2) {
      isTruncated = true;
      while (rawHistory.length > 2 && calculateLength(rawHistory, fullSystemPrompt.length) > maxBudget) rawHistory = rawHistory.slice(1);
    }

    if (semanticState?.isFollowUp && rawHistory.length > 6) {
      rawHistory = rawHistory.slice(-6);
      isTruncated = true;
    }

    const finalLength = fullSystemPrompt.length + options.userMessage.length + rawHistory.reduce((sum, item) => sum + item.content.length, 0);
    const tokenCountEstimate = Math.ceil(finalLength / 4);

    logger.info({
      telegramUserId,
      tokenCountEstimate,
      isTruncated,
      historyLength: rawHistory.length,
      relevantMemoryCount: memories.length,
      appliedPreferencesCount: resolution.appliedPreferences.length,
      suppressedCount: resolution.suppressedInstructions.length,
      semanticFollowUp: semanticState?.isFollowUp ?? false,
      semanticOperation: semanticState?.operation,
      semanticConfidence: semanticState?.confidence,
      semanticUnresolvedReference: Boolean(semanticState?.unresolvedReference),
    }, "CONTEXT_ASSEMBLED_WITH_PRECEDENCE");

    return {
      effectiveSystemPrompt: fullSystemPrompt,
      formattedMemories,
      formattedTaskContext,
      conversationSummary,
      history: rawHistory,
      tokenCountEstimate,
      isTruncated,
    };
  }
}

export const contextManagerService = new ContextManagerService();
