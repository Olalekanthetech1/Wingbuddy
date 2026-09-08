import { memoryService } from "./memory.service";
import { taskService } from "./task.service";
import { instructionResolutionService } from "./instruction-resolution.service";
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

  /**
   * Assembles a complete, budgeted, context-aware prompt payload for Gemini using dynamic instruction precedence resolution.
   */
  async assembleContext(options: {
    telegramUserId: number | bigint;
    conversationId?: number;
    userMessage: string;
    effectiveModeInstruction: string;
    activeTask?: { task: AgentTaskRecord; steps: AgentTaskStepRecord[] } | null;
    history?: Array<{ role: string; content: string }>;
    maxCharBudget?: number;
  }): Promise<AssembledContext> {
    const telegramUserId = Number(options.telegramUserId);
    const maxBudget = options.maxCharBudget ?? ContextManagerService.DEFAULT_MAX_CHAR_BUDGET;

    // 1. Fetch raw persistent user memories
    const memories = await memoryService.getMemories(telegramUserId);
    const formattedMemories = await memoryService.formatMemoriesForPrompt(telegramUserId);

    // 2. Fetch or format task context
    let activeTaskData = options.activeTask || null;
    let formattedTaskContext = "";
    if (activeTaskData) {
      formattedTaskContext = taskService.formatTaskForPrompt(
        activeTaskData.task,
        activeTaskData.steps,
      );
    } else {
      const activeTasks = await taskService.getActiveTasksForUser(telegramUserId);
      if (activeTasks.length > 0) {
        const primaryTask = activeTasks[0];
        const steps = await chatDatabaseService.getTaskSteps(primaryTask.id);
        activeTaskData = { task: primaryTask, steps };
        formattedTaskContext = taskService.formatTaskForPrompt(primaryTask, steps);
      }
    }

    // 3. Fetch conversation summary if conversationId is provided
    let conversationSummary = "";
    let sessionSummaries: Array<{ summary: string }> = [];
    if (options.conversationId) {
      const summaryRecord = await chatDatabaseService.getLatestSummaryForConversation(
        options.conversationId,
      );
      if (summaryRecord) {
        conversationSummary = `\n\n[PAST CONVERSATION SUMMARY]\n${summaryRecord.summary}`;
        sessionSummaries.push({ summary: summaryRecord.summary });
      }
    }

    // 4. Budgeting and History Pruning
    let rawHistory = options.history || [];
    let isTruncated = false;

    // Estimate total character usage
    const calculateLength = (hist: Array<{ role: string; content: string }>, sysPromptLength: number) => {
      const histLength = hist.reduce((sum, h) => sum + h.content.length, 0);
      return (
        sysPromptLength +
        options.userMessage.length +
        histLength
      );
    };

    // 5. Resolve Instruction Precedence Dynamically via InstructionResolutionService
    const resolution = instructionResolutionService.resolvePrecedence({
      effectiveModeInstruction: options.effectiveModeInstruction,
      userMessage: options.userMessage,
      memories,
      activeTask: activeTaskData,
      sessionSummaries,
      semanticRecall: rawHistory.slice(-4).map((h) => ({ role: h.role, content: h.content })),
    });

    let fullSystemPrompt = resolution.effectiveSystemPrompt + conversationSummary;

    let currentLength = calculateLength(rawHistory, fullSystemPrompt.length);

    // If exceeding budget, prune older history turns while retaining system prompts & current message
    if (currentLength > maxBudget && rawHistory.length > 2) {
      isTruncated = true;
      logger.info(
        { telegramUserId, currentLength, maxBudget, originalTurns: rawHistory.length },
        "CONTEXT_TRUNCATED",
      );

      while (rawHistory.length > 2 && calculateLength(rawHistory, fullSystemPrompt.length) > maxBudget) {
        rawHistory = rawHistory.slice(1);
      }
    }

    const finalLength = fullSystemPrompt.length + options.userMessage.length + rawHistory.reduce((a, b) => a + b.content.length, 0);
    const tokenCountEstimate = Math.ceil(finalLength / 4);

    logger.info(
      { telegramUserId, tokenCountEstimate, isTruncated, historyLength: rawHistory.length, appliedPreferencesCount: resolution.appliedPreferences.length, suppressedCount: resolution.suppressedInstructions.length },
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

