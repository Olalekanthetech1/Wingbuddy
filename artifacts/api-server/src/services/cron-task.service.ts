import { PrismaClient } from "@prisma/client";
import { logger } from "../lib/logger";
import cronParser from "cron-parser";
const { parseExpression } = cronParser;
import type { Bot } from "grammy";
import { chatDatabaseService, getPool } from "@workspace/db";
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

export interface DatabaseSnapshotSummary {
  timestamp: string;
  databaseName?: string;
  databaseSizeBytes?: number;
  databaseSizeFormatted?: string;
  counts: {
    users: number;
    conversations: number;
    messages: number;
    memories: number;
    agentTasks: number;
    reminders: number;
    systemSettings: number;
    executionGraphs: number;
  };
  notifiedAdminIds: (number | bigint)[];
  status: "success" | "partial" | "failed";
  error?: string;
}

export class CronTaskService {
  private bot: Bot | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private isPolling = false;

  attachBot(bot: Bot) {
    this.bot = bot;
    logger.info("CronTaskService bot attached.");
    void this.ensureWeeklySnapshotTask();
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
    void this.ensureWeeklySnapshotTask();
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    logger.info("CronTaskService polling stopped.");
  }

  /**
   * Retrieves configured admin user IDs from environment variables
   */
  getAdminUserIds(): (number | bigint)[] {
    const ids: (number | bigint)[] = [];
    const envAdminId = process.env.ADMIN_TELEGRAM_ID || process.env.ADMIN_USER_ID;
    if (envAdminId && Number.isSafeInteger(Number(envAdminId))) {
      ids.push(Number(envAdminId));
    }

    const envList = process.env.ADMIN_USER_IDS;
    if (envList) {
      const parts = envList.split(",").map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        if (Number.isSafeInteger(Number(part))) {
          const num = Number(part);
          if (!ids.includes(num)) {
            ids.push(num);
          }
        }
      }
    }

    return ids;
  }

  /**
   * Ensures the recurring weekly database snapshot schedule is registered
   */
  async ensureWeeklySnapshotTask(): Promise<void> {
    try {
      const existing = await prisma.agentTask.findFirst({
        where: {
          taskType: "system_snapshot",
          isRecurring: true,
        },
      });

      if (!existing) {
        const nextRunAt = computeNextUtcRun({
          cronExpression: "0 0 * * 0", // Every Sunday at 00:00 UTC
          isRecurring: true,
          timezone: "UTC",
          baseDate: new Date(),
        });

        await prisma.agentTask.create({
          data: {
            telegramUserId: BigInt(this.getAdminUserIds()[0] || 1),
            title: "System: Weekly Database Snapshot",
            goal: "Automated weekly PostgreSQL snapshot verification and admin notification",
            taskType: "system_snapshot",
            isRecurring: true,
            cronExpression: "0 0 * * 0",
            timezone: "UTC",
            nextRunAt,
            status: "pending",
          },
        });
        logger.info("Registered automated weekly database snapshot task in cron scheduler.");
      }
    } catch (err) {
      logger.warn({ error: err }, "Could not register default weekly database snapshot task");
    }
  }

  /**
   * Triggers a database snapshot, saves snapshot metadata, and sends confirmation notification to admin.
   */
  async triggerWeeklyDatabaseSnapshot(adminUserIdOverride?: number | bigint): Promise<DatabaseSnapshotSummary> {
    const timestamp = new Date().toISOString();
    const summary: DatabaseSnapshotSummary = {
      timestamp,
      counts: {
        users: 0,
        conversations: 0,
        messages: 0,
        memories: 0,
        agentTasks: 0,
        reminders: 0,
        systemSettings: 0,
        executionGraphs: 0,
      },
      notifiedAdminIds: [],
      status: "success",
    };

    try {
      const pool = getPool();

      // Gather table counts
      const [
        usersCount,
        convCount,
        msgCount,
        memCount,
        tasksCount,
        remindersCount,
        settingsCount,
        graphsCount,
      ] = await Promise.all([
        prisma.user.count().catch(() => 0),
        prisma.conversation.count().catch(() => 0),
        prisma.message.count().catch(() => 0),
        prisma.userMemory.count().catch(() => 0),
        prisma.agentTask.count().catch(() => 0),
        prisma.reminder.count().catch(() => 0),
        prisma.systemSetting.count().catch(() => 0),
        prisma.executionGraphRecord.count().catch(() => 0),
      ]);

      summary.counts = {
        users: usersCount,
        conversations: convCount,
        messages: msgCount,
        memories: memCount,
        agentTasks: tasksCount,
        reminders: remindersCount,
        systemSettings: settingsCount,
        executionGraphs: graphsCount,
      };

      // Query database size if supported
      try {
        const dbMeta = await pool.query(
          "SELECT current_database() as db_name, pg_database_size(current_database()) as size_bytes, pg_size_pretty(pg_database_size(current_database())) as size_pretty"
        );
        if (dbMeta.rows[0]) {
          summary.databaseName = dbMeta.rows[0].db_name;
          summary.databaseSizeBytes = Number(dbMeta.rows[0].size_bytes);
          summary.databaseSizeFormatted = dbMeta.rows[0].size_pretty;
        }
      } catch {
        // Non-critical if pg_size_pretty is restricted
      }

      // Record snapshot manifest in system_settings
      try {
        await pool.query(
          `INSERT INTO system_settings (key, value, updated_at)
           VALUES ('LAST_DATABASE_SNAPSHOT', $1, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [JSON.stringify(summary)]
        );
      } catch (saveErr) {
        logger.warn({ error: saveErr }, "Could not persist snapshot manifest to system_settings");
      }

      // Build confirmation notification message
      const sizeInfo = summary.databaseSizeFormatted ? `💾 <b>Size:</b> ${summary.databaseSizeFormatted}\n` : "";
      const notificationHtml = [
        `📦 <b>Weekly Database Snapshot Completed</b>\n`,
        `🕒 <b>Timestamp:</b> <code>${timestamp}</code>`,
        summary.databaseName ? `🗄️ <b>Database:</b> <code>${summary.databaseName}</code>` : "",
        sizeInfo,
        `📊 <b>Live Entity Summary:</b>`,
        `• <b>Registered Users:</b> ${summary.counts.users}`,
        `• <b>Conversations:</b> ${summary.counts.conversations}`,
        `• <b>Messages:</b> ${summary.counts.messages}`,
        `• <b>Memory Vault:</b> ${summary.counts.memories}`,
        `• <b>Autonomous Tasks:</b> ${summary.counts.agentTasks}`,
        `• <b>Scheduled Reminders:</b> ${summary.counts.reminders}`,
        `• <b>Execution Graphs:</b> ${summary.counts.executionGraphs}`,
        `\n✅ <i>Snapshot verified and state synchronized.</i>`,
      ].filter(Boolean).join("\n");

      // Determine recipient admin IDs
      const targetAdminIds = adminUserIdOverride
        ? [adminUserIdOverride]
        : this.getAdminUserIds();

      if (this.bot && targetAdminIds.length > 0) {
        for (const adminId of targetAdminIds) {
          try {
            await this.bot.api.sendMessage(Number(adminId), notificationHtml, {
              parse_mode: "HTML",
            });
            summary.notifiedAdminIds.push(adminId);
            logger.info({ adminId }, "Sent weekly database snapshot confirmation notification to admin");
          } catch (sendErr: any) {
            logger.warn(
              { adminId, error: sendErr?.message || String(sendErr) },
              "Failed sending weekly snapshot notification to admin user"
            );
          }
        }
      } else if (!this.bot) {
        logger.info("Bot not attached; snapshot completed without Telegram push notification");
      } else {
        logger.info("No admin Telegram IDs configured; snapshot completed and saved to system_settings");
      }

      return summary;
    } catch (err: any) {
      summary.status = "failed";
      summary.error = err?.message || String(err);
      logger.error({ error: err }, "Weekly database snapshot execution failed");
      return summary;
    }
  }

  async pollTasks() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const now = new Date();
      // Find tasks that are due
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

    if (task.taskType === "system_snapshot") {
      const snapshot = await this.triggerWeeklyDatabaseSnapshot(Number(task.telegramUserId));
      return {
        success: snapshot.status === "success",
        message: `Database snapshot completed at ${snapshot.timestamp} (${snapshot.counts.messages} messages, ${snapshot.counts.users} users).`,
      };
    }

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
    logger.info({ taskId: task.id, taskType: task.taskType }, "Executing scheduled task");
    try {
      // Handle special system_snapshot task type
      if (task.taskType === "system_snapshot") {
        await this.triggerWeeklyDatabaseSnapshot(Number(task.telegramUserId));

        const nextRunAt = computeNextUtcRun({
          cronExpression: task.cronExpression || "0 0 * * 0",
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
        });
        return;
      }

      if (!this.bot) {
        logger.warn("Bot is not attached, cannot send scheduled task result.");
        return;
      }

      // Check if this task is explicitly a conditional watcher
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
        baseDate: new Date(Date.now() + 300_000),
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
