import { PrismaClient } from "@prisma/client";
import { logger } from "../lib/logger";
import cronParser from "cron-parser";
const { parseExpression } = cronParser;
import type { Bot } from "grammy";
import { chatDatabaseService } from "@workspace/db";
import { scheduledTaskFlowService } from "./scheduled-task-flow.service";
import { timezoneService } from "./timezone.service";
import { agentPlannerService } from "../planner/agent-planner.service";
import {
  getUtcWeekdayName,
  getUtcWeekdayIndex,
  computeNextUtcRun,
  formatDynamicScheduleDescription,
} from "../utils/cron-date-utils";

export {
  getUtcWeekdayName,
  getUtcWeekdayIndex,
  computeNextUtcRun,
  formatDynamicScheduleDescription,
};

const prisma = new PrismaClient();

export class CronTaskService {
  private bot: Bot | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private isPolling = false;

  attachBot(bot: Bot) {
    this.bot = bot;
    logger.info("CronTaskService bot attached.");
  }

  detachBot() {
    this.bot = null;
    logger.info("CronTaskService bot detached.");
  }

  isPollingActive(): boolean {
    return Boolean(this.pollInterval);
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
    if (!this.bot) {
      logger.debug("CronTaskService: Bot not attached yet, skipping polling tick.");
      return;
    }
    this.isPolling = true;

    try {
      const now = new Date();
      // Find tasks that are due (both recurring standing instructions and one-time scheduled runs)
      const dueTasks = await prisma.agentTask.findMany({
        where: {
          status: "pending",
          nextRunAt: {
            lte: now,
          },
        },
      });

      if (dueTasks.length > 0) {
        logger.info(`Found ${dueTasks.length} scheduled tasks due.`);
      }

      for (const task of dueTasks) {
        await this.executeRecurringTask(task);
      }
    } finally {
      this.isPolling = false;
    }
  }

  async executeTaskNow(taskId: number): Promise<{ success: boolean; message: string }> {
    const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
    if (!task) return { success: false, message: "Task not found." };
    const result = await scheduledTaskFlowService.executeTask(taskId, { isManualRun: true });
    if (this.bot && result.formattedMessage) {
      const keyboard = scheduledTaskFlowService.taskActionsKeyboard(task);
      await this.bot.api.sendMessage(Number(task.telegramUserId), result.formattedMessage, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    }
    return { success: result.success, message: result.formattedMessage };
  }

  private async executeRecurringTask(task: any) {
    logger.info({ taskId: task.id }, "Executing scheduled task");
    try {
      if (!this.bot) {
        logger.warn("Bot is not attached, cannot send scheduled task result.");
        return;
      }

      // Check if this task is explicitly a conditional watcher (e.g. "alert if...", "notify if...", watcher category)
      const isConditionalWatcher =
        (typeof task.metadataJson === "string" && task.metadataJson.includes('"type":"watcher"')) ||
        /\b(alert (?:me )?if|notify (?:me )?if|watch for|warn (?:me )?if|only if)\b/i.test(task.goal || "") ||
        /\b(watcher|price alert|uptime check)\b/i.test(task.title || "");

      let watcherHandled = false;
      if (isConditionalWatcher) {
        try {
          const planResult = await agentPlannerService.planAndCompile({
            telegramUserId: Number(task.telegramUserId),
            goal: task.goal,
            taskId: task.id,
            context: {
              activeTask: { id: task.id, title: task.title, goal: task.goal },
              isBackgroundTask: true,
              isConditionalWatcher: true,
            },
          });

          if (planResult?.isDirectResponse && planResult.directResponse) {
            let clean = planResult.directResponse.trim();
            if (clean.startsWith("```")) {
              clean = clean.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
            }
            try {
              const parsed = JSON.parse(clean);
              if (parsed && typeof parsed === "object") {
                if (parsed.action === "silent") {
                  logger.info({ taskId: task.id, reason: parsed.reason }, "Structured watcher condition evaluated to silent; suppressing telegram message");
                  watcherHandled = true;
                } else if (parsed.action === "notify") {
                  const notifyMsg = parsed.message || planResult.directResponse;
                  const keyboard = scheduledTaskFlowService.taskActionsKeyboard(task);
                  await this.bot.api.sendMessage(Number(task.telegramUserId), notifyMsg, {
                    parse_mode: "HTML",
                    reply_markup: keyboard,
                  });
                  watcherHandled = true;
                }
              }
            } catch {}
          }
        } catch (planErr) {
          logger.debug({ error: planErr, taskId: task.id }, "Structured watcher evaluation skipped or failed, falling back to scheduled task flow");
        }
      }

      if (!watcherHandled) {
        const result = await scheduledTaskFlowService.executeTask(task.id, { isManualRun: false });
        if (result?.formattedMessage) {
          const keyboard = scheduledTaskFlowService.taskActionsKeyboard(task);
          await this.bot.api.sendMessage(Number(task.telegramUserId), result.formattedMessage, {
            parse_mode: "HTML",
            reply_markup: keyboard,
          });

          if (task.conversationId) {
            await chatDatabaseService.addMessage({
              conversationId: task.conversationId,
              senderType: "model",
              content: result.formattedMessage,
            });
          }
        }
      }

      // Calculate next run date dynamically based on system UTC time
      const nextRunAt = computeNextUtcRun({
        cronExpression: task.cronExpression,
        isRecurring: task.isRecurring,
        timezone: task.timezone || "UTC",
        baseDate: new Date(),
      });

      await prisma.agentTask.update({
        where: { id: task.id },
        data: {
          lastRunAt: new Date(),
          nextRunAt: task.isRecurring ? nextRunAt : null,
          status: task.isRecurring ? "pending" : "completed",
        },
      }).catch((updateErr) => {
        logger.warn({ error: updateErr, taskId: task.id }, "Failed to update task execution state in DB");
      });
    } catch (err) {
      logger.error({ taskId: task.id, error: err }, "Error executing scheduled task");
      // Advance nextRunAt on error so it does not retry every 60 seconds endlessly
      const safeNext = computeNextUtcRun({
        cronExpression: task.cronExpression,
        isRecurring: task.isRecurring,
        timezone: task.timezone || "UTC",
        baseDate: new Date(Date.now() + 300_000), // at least 5 minutes out in UTC
      });
      await prisma.agentTask.update({
        where: { id: task.id },
        data: {
          lastRunAt: new Date(),
          nextRunAt: task.isRecurring ? safeNext : null,
          status: task.isRecurring ? "pending" : "failed",
        },
      }).catch(() => {});
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
    const tz = params.timezone || (await timezoneService.getUserTimezone(params.telegramUserId));
    const nextRunAt = computeNextUtcRun({
      cronExpression: params.cronExpression,
      isRecurring: true,
      timezone: tz,
      baseDate: new Date(),
    });

    if (!nextRunAt) {
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
        timezone: tz,
        nextRunAt,
        status: "pending",
      },
    });

    return created;
  }
}

export const cronTaskService = new CronTaskService();

