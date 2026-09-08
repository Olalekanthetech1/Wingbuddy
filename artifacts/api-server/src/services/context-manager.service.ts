import { memoryService } from "./memory.service";
import { taskService } from "./task.service";
import { instructionResolutionService } from "./instruction-resolution.service";
import {
  conversationIntelligenceService,
  type ConversationSemanticState,
} from "./conversation-intelligence.service";
import { GeminiService } from "../gemini/gemini.service";
import { getConfig } from "../config/env";
import { chatDatabaseService, type AgentTaskRecord, type AgentTaskStepRecord } from "@workspace/db";
import { logger } from "../lib/logger";

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
  private static readonly DEFAULT_MAX_CHAR_BUDGET = 120_000; // ~30k tokens
  private gemini?: GeminiService;

  private getGemini(): GeminiService {
    if (!this.gemini) {
      const config = getConfig();
      this.gemini = new GeminiService(
        config.geminiApiKey,
        config.geminiModel,
        config.geminiTimeoutMs,
      );
    }
    return this.gemini;
  }

  /**
   * Assembles a complete, budgeted, context-aware prompt payload for Gemini using dynamic instruction precedence and semantic conversation state.
   */
  async assembleContext(options: {
    telegramUserId: number | bigint;
    conversationId?: number;
    userMessage: string;
    effectiveModeInstruction: string;
    activeTask?: { task: AgentTaskRecord; steps: AgentTaskStepRecord[] } | null;
    history?: Array<{ role: string; content: string }>;
    semanticState?: ConversationSemanticState | null;
    maxCharBudget?: number;
  }): Promise<AssembledContext> {
    const telegramUserId = Number(options.telegramUserId);
    const maxBudget = options.maxCharBudget ?? ContextManagerService.DEFAULT_MAX_CHAR_BUDGET;

    const memories = await memoryService.getMemories(telegramUserId);
    const formattedMemories = await memoryService.formatMemoriesForPrompt(telegramUserId);

    let activeTaskData = options.activeTask || null;
    let formattedTaskContext = "";
    if (activeTaskData) {
      formattedTaskContext = taskService.formatTaskForPrompt(activeTaskData.task, activeTaskData.steps);
    } else {
      const activeTasks = await taskService.getActiveTasksForUser(telegramUserId);
      if (activeTasks.length > 0) {
        const primaryTask = activeTasks[0];
        const steps = await chatDatabaseService.getTaskSteps(primaryTask.id);
        activeTaskData = { task: primaryTask, steps };
        formattedTaskContext = taskService.formatTaskForPrompt(primaryTask, steps);
      }
    }

    let conversationSummary = "";
    let sessionSummaries: Array<{ summary: string }> = [];
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
      try {
        semanticState = await conversationIntelligenceService.analyzeSemanticState(
          options.userMessage,
          rawHistory,
          async (history, analysisPrompt) =>
            this.getGemini().generateReply(
              history,
              analysisPrompt,
              "Act as the conversation-state interpreter. Return the exact JSON requested by the user prompt. Do not answer the underlying user request.",
            ),
        );
      } catch (error) {
        logger.debug?.(
          { telegramUserId, error: error instanceof Error ? error.message : String(error) },
          "Semantic conversation analysis fell back to deterministic continuity state",
        );
      }
    }

    const continuity = conversationIntelligenceService.resolve(options.userMessage, rawHistory);
    const continuityInstruction = conversationIntelligenceService.buildContextInstruction(continuity);
    const semanticInstruction = semanticState
      ? conversationIntelligenceService.buildSemanticContextInstruction(semanticState)
      : "";

    const calculateLength = (hist: Array<{ role: string; content: string }>, sysPromptLength: number) => {
      const histLength = hist.reduce((sum, h) => sum + h.content.length, 0);
      return sysPromptLength + options.userMessage.length + histLength;
    };

    const resolution = instructionResolutionService.resolvePrecedence({
      effectiveModeInstruction: options.effectiveModeInstruction,
      userMessage: options.userMessage,
      memories,
      activeTask: activeTaskData,
      sessionSummaries,
      semanticRecall: rawHistory.slice(-4).map((h) => ({ role: h.role, content: h.content })),
    });

    let fullSystemPrompt = resolution.effectiveSystemPrompt + conversationSummary;
    if (continuityInstruction) {
      fullSystemPrompt += `\n\n${continuityInstruction}`;
    }
    if (semanticInstruction) {
      fullSystemPrompt += `\n\n${semanticInstruction}`;
    }

    let currentLength = calculateLength(rawHistory, fullSystemPrompt.length);
    if (currentLength > maxBudget && rawHistory.length > 2) {
      isTruncated = true;
      logger.info({ telegramUserId, currentLength, maxBudget, originalTurns: rawHistory.length }, "CONTEXT_TRUNCATED");
      while (rawHistory.length > 2 && calculateLength(rawHistory, fullSystemPrompt.length) > maxBudget) {
        rawHistory = rawHistory.slice(1);
      }
    }

    // Continuity targets must survive history pruning. If a follow-up is detected,
    // preserve a bounded recent window containing the target before trimming.
    if ((continuity.isFollowUp || semanticState?.isFollowUp) && rawHistory.length > 0) {
      const recentWindow = rawHistory.slice(-6);
      if (recentWindow.length < rawHistory.length) {
        rawHistory = recentWindow;
        isTruncated = true;
      }
    }

    const finalLength = fullSystemPrompt.length + options.userMessage.length + rawHistory.reduce((a, b) => a + b.content.length, 0);
    const tokenCountEstimate = Math.ceil(finalLength / 4);

    logger.info(
      {
        telegramUserId,
        tokenCountEstimate,
        isTruncated,
        historyLength: rawHistory.length,
        appliedPreferencesCount: resolution.appliedPreferences.length,
        suppressedCount: resolution.suppressedInstructions.length,
        continuityFollowUp: continuity.isFollowUp,
        continuityConfidence: continuity.confidence,
        continuityReferenceType: continuity.referenceType,
        semanticFollowUp: semanticState?.isFollowUp ?? false,
        semanticOperation: semanticState?.operation,
        semanticConfidence: semanticState?.confidence,
        semanticUnresolvedReference: Boolean(semanticState?.unresolvedReference),
      },
      "CONTEXT_ASSEMBLED_WITH_PRECEDENCE",
    );

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
