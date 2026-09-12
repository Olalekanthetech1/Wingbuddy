import { PrismaClient } from "@prisma/client";
import { logger } from "../lib/logger";
import cronParser from "cron-parser";
const { parseExpression } = cronParser;
import type { Bot } from "grammy";
import { taskService } from "./task.service";
import { agentPlannerService } from "../planner/agent-planner.service";
import { executionEngine } from "../execution/execution-engine";
import { executionPersistence } from "../execution/persistence/execution-persistence.service";
import { chatDatabaseService } from "@workspace/db";
import { contextManagerService } from "./context-manager.service";

const prisma = new PrismaClient();

export class CronTaskService {
  private bot: Bot | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private isPolling = false;

  attachBot(bot: Bot) {
    this.bot = bot;
  }

  detachBot() {
    this.bot = null;
  }

  startPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    // Poll every 1 minute
    this.pollInterval = setInterval(() => {
      this.pollTasks().catch((err) => {
        logger.error({ error: err }, "Error polling recurring tasks");
      });
    }, 60000);
    logger.info("CronTaskService polling started.");
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    logger.info("CronTaskService polling stopped.");
  }

  async pollTasks() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const now = new Date();
      // Find tasks that are due
      const dueTasks = await prisma.agentTask.findMany({
        where: {
          isRecurring: true,
          status: "pending",
          nextRunAt: {
            lte: now,
          },
        },
      });

      if (dueTasks.length > 0) {
        logger.info(`Found ${dueTasks.length} recurring tasks due.`);
      }

      for (const task of dueTasks) {
        await this.executeRecurringTask(task);
      }
    } finally {
      this.isPolling = false;
    }
  }

  private async executeRecurringTask(task: any) {
    logger.info({ taskId: task.id }, "Executing recurring task");
    try {
      // 1. Calculate the next run time
      let nextRunAt: Date | null = null;
      if (task.cronExpression) {
        try {
          const interval = parseExpression(task.cronExpression, {
            currentDate: new Date(),
            tz: task.timezone || "UTC",
          });
          nextRunAt = interval.next().toDate();
        } catch (cronErr) {
          logger.error({ error: cronErr, cron: task.cronExpression }, "Failed to parse cron");
        }
      }

      // Update lastRunAt and nextRunAt immediately to prevent double execution
      await prisma.agentTask.update({
        where: { id: task.id },
        data: {
          lastRunAt: new Date(),
          nextRunAt: nextRunAt,
        },
      });

      // 2. Generate content / plan execution
      if (!this.bot) {
        logger.warn("Bot is not attached, cannot send recurring task result.");
        return;
      }

      // We use the Agent Planner to process the task goal autonomously
      const conversationId = task.conversationId;
      let history = [];
      if (conversationId) {
          const rawHistory = await chatDatabaseService.getConversationMessages(conversationId, 10);
          history = rawHistory.map(m => ({ role: m.senderType === "user" ? "user" : "model", content: m.content }));
      }
      
      const planResult = await agentPlannerService.planAndCompile({
        telegramUserId: Number(task.telegramUserId),
        goal: task.goal,
        taskId: task.id,
        context: {
          conversationHistory: history as any,
          activeTask: { id: task.id, goal: task.goal },
          isBackgroundTask: true
        }
      });

      let finalAnswer = "";
      if (planResult.success && planResult.graph && !planResult.isDirectResponse) {
        const session = await executionEngine.startExecution({
          graphId: planResult.graph.graphId,
          planRevision: 1,
          requestId: `cron_${Date.now()}_${task.id}`,
          taskId: task.id,
          executionContext: { telegramUserId: Number(task.telegramUserId), chatId: Number(task.telegramUserId) /* typically same */, conversationId }
        });
        
        if (session.status === "completed" || (session.status as string) === "COMPLETED") {
          const completedAttempts = await executionPersistence.getCompletedExecutionsForGraph(planResult.graph.graphId, 1);
          const nodeResults: Record<string, any> = {};
          for (const att of completedAttempts) if (att.result) nodeResults[att.nodeId] = att.result;
          
          const reverseNodeIds = [...Object.keys(planResult.graph.nodes)].reverse();
          for (const nodeId of reverseNodeIds) {
            const res = nodeResults[nodeId]; if (!res?.output) continue; const out = res.output;
            if (typeof out === "string") { finalAnswer = out; break; }
            if (out.response && typeof out.response === "string") { finalAnswer = out.response; break; }
            if (out.summary && typeof out.summary === "string") { finalAnswer = out.summary; break; }
          }
        }
      } else if (planResult.success && planResult.isDirectResponse && planResult.directResponse) {
          finalAnswer = planResult.directResponse;
      }

      let action = "notify";
      let messageToUser = finalAnswer;
      let rawAnswer = finalAnswer;

      if (rawAnswer) {
        try {
          let jsonStr = rawAnswer.trim();
          if (jsonStr.startsWith("```json")) {
            jsonStr = jsonStr.substring(7, jsonStr.length - 3).trim();
          } else if (jsonStr.startsWith("```")) {
            jsonStr = jsonStr.substring(3, jsonStr.length - 3).trim();
          }
          const parsed = JSON.parse(jsonStr);
          if (parsed && typeof parsed.action === "string") {
            if (parsed.action === "silent") action = "silent";
            if (parsed.action === "notify") action = "notify";
            if (parsed.message) messageToUser = parsed.message;
          }
        } catch (e) {
          // If not valid JSON, treat as raw message. Fallback for safety.
          if (rawAnswer.includes("[SILENT]") || rawAnswer.includes("[CONDITION_NOT_MET]")) {
            action = "silent";
          }
        }
      }

      if (action === "silent") {
          logger.info({ taskId: task.id }, "Task condition not met (structured silent response). Skipping telegram message.");
          return;
      }

      if (!messageToUser || messageToUser.trim() === "" || messageToUser === "{}") {
          messageToUser = `🔄 Recurring Task "${task.title}" has been processed!`;
      }
      
      finalAnswer = messageToUser;

      const formattedAnswer = `⏰ <b>Routine Check: ${task.title}</b>\n\n${finalAnswer}`;

      await this.bot.api.sendMessage(Number(task.telegramUserId), formattedAnswer, { parse_mode: "HTML" });
      
      if (conversationId) {
          await chatDatabaseService.addMessage({
              conversationId,
              senderType: "model",
              content: formattedAnswer
          });
      }

    } catch (err) {
      logger.error({ taskId: task.id, error: err }, "Error executing recurring task");
    }
  }

  // Exposed for SemanticInteractionResolver to create a scheduled task
  async scheduleRecurringTask(params: {
    telegramUserId: number | bigint;
    conversationId?: number;
    title: string;
    goal: string;
    cronExpression: string;
    timezone?: string;
  }) {
    let nextRunAt: Date | null = null;
    try {
      const interval = parseExpression(params.cronExpression, {
        currentDate: new Date(),
        tz: params.timezone || "UTC",
      });
      nextRunAt = interval.next().toDate();
    } catch (e) {
      throw new Error(`Invalid cron expression: ${params.cronExpression}`);
    }

    const created = await prisma.agentTask.create({
      data: {
        telegramUserId: params.telegramUserId,
        conversationId: params.conversationId,
        title: params.title,
        goal: params.goal,
        isRecurring: true,
        cronExpression: params.cronExpression,
        timezone: params.timezone || "UTC",
        nextRunAt,
        status: "pending",
      },
    });

    return created;
  }
}

export const cronTaskService = new CronTaskService();
