import { PrismaClient } from "@prisma/client";
import { logger } from "../lib/logger";
import cronParser from "cron-parser";
const { parseExpression } = cronParser;
import type { Bot } from "grammy";
import { chatDatabaseService } from "@workspace/db";
import { scheduledTaskFlowService } from "./scheduled-task-flow.service";
import { timezoneService } from "./timezone.service";

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

      const result = await scheduledTaskFlowService.executeTask(task.id, { isManualRun: false });
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
    } catch (err) {
      logger.error({ taskId: task.id, error: err }, "Error executing scheduled task");
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
    let nextRunAt: Date | null = null;
    try {
      const interval = parseExpression(params.cronExpression, {
        currentDate: new Date(),
        tz,
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
        timezone: tz,
        nextRunAt,
        status: "pending",
      },
    });

    return created;
  }
}

export const cronTaskService = new CronTaskService();

