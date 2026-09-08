import { and, desc, eq, lte } from "drizzle-orm";
import { db, remindersTable, type Reminder, cdcService, type ReminderCdcEvent } from "@workspace/db";
import { logger } from "../lib/logger";
import { safeErrorMetadata } from "../utils/safe-error";
import type { Bot } from "grammy";

export interface ParsedReminder {
  isReminder: boolean;
  prompt: string;
  dueAt: Date;
  humanReadableTime: string;
}

export class ReminderService {
  /**
   * Intelligently parses natural language text for reminder intents and due dates.
   * Handles relative durations ("in 15 mins", "in 2 hours"), specific clock times
   * ("at 4:30 pm", "tomorrow at 9am"), days of the week, and keywords.
   */
  static parseNaturalReminder(
    text: string,
    now: Date = new Date(),
  ): ParsedReminder | null {
    const trimmed = text.trim();

    // 1. Check for reminder trigger prefixes
    const triggerMatch = trimmed.match(
      /^(?:\/remind(?:er)?\b\s*|remind\s+me\s+(?:to\s+|about\s+|that\s+)?|set\s+(?:a\s+)?reminder\s+(?:to\s+|for\s+)?|reminder:\s*)/i,
    );

    const isCommand = /^\/remind(?:er)?\b/i.test(trimmed);
    if (!triggerMatch && !isCommand) {
      // Also check for embedded "remind me in X to Y"
      const embeddedMatch = trimmed.match(/\bremind\s+me\s+/i);
      if (!embeddedMatch) return null;
    }

    // Clean body after trigger
    let body = trimmed;
    if (triggerMatch) {
      body = trimmed.slice(triggerMatch[0].length).trim();
    } else {
      const idx = trimmed.search(/\bremind\s+me\s+/i);
      if (idx !== -1) {
        body = trimmed.slice(idx + 10).trim();
        body = body.replace(/^(?:to|about|that)\s+/i, "");
      }
    }

    if (!body) return null;

    // Pattern A: "in X minutes/hours/days to [task]" or "[task] in X minutes/hours"
    const relativeMatch =
      body.match(
        /^(?:in\s+)?(\d+)\s*(s|sec|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?)(?:\s+(?:to\s+|about\s+|that\s+)?(.*))?$/i,
      ) ||
      body.match(
        /^(.*?)\s+in\s+(\d+)\s*(s|sec|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?)$/i,
      );

    if (relativeMatch) {
      let amount: number;
      let unit: string;
      let prompt: string;

      if (/^(?:in\s+)?\d+/i.test(body)) {
        amount = parseInt(relativeMatch[1], 10);
        unit = relativeMatch[2].toLowerCase();
        prompt = (relativeMatch[3] || "").trim() || "Reminder";
      } else {
        prompt = (relativeMatch[1] || "").trim() || "Reminder";
        amount = parseInt(relativeMatch[2], 10);
        unit = relativeMatch[3].toLowerCase();
      }

      prompt = prompt.replace(/^(?:to|about|that)\s+/i, "").trim() || "Reminder";

      let multiplierMs = 60 * 1000; // default minutes
      let unitLabel = "minutes";

      if (unit.startsWith("s")) {
        multiplierMs = 1000;
        unitLabel = amount === 1 ? "second" : "seconds";
      } else if (unit.startsWith("m")) {
        multiplierMs = 60 * 1000;
        unitLabel = amount === 1 ? "minute" : "minutes";
      } else if (unit.startsWith("h")) {
        multiplierMs = 60 * 60 * 1000;
        unitLabel = amount === 1 ? "hour" : "hours";
      } else if (unit.startsWith("d")) {
        multiplierMs = 24 * 60 * 60 * 1000;
        unitLabel = amount === 1 ? "day" : "days";
      } else if (unit.startsWith("w")) {
        multiplierMs = 7 * 24 * 60 * 60 * 1000;
        unitLabel = amount === 1 ? "week" : "weeks";
      }

      const dueAt = new Date(now.getTime() + amount * multiplierMs);
      return {
        isReminder: true,
        prompt,
        dueAt,
        humanReadableTime: `in ${amount} ${unitLabel} (${dueAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`,
      };
    }

    // Pattern B: "tomorrow at 9:00 am [task]" or "[task] tomorrow at 9am"
    const tomorrowTimeMatch =
      body.match(
        /^(?:tomorrow\s+at\s+|tomorrow\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(?:to\s+|about\s+|that\s+)?(.*))?$/i,
      ) ||
      body.match(
        /^(.*?)\s+(?:tomorrow\s+at\s+|tomorrow\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
      );

    if (tomorrowTimeMatch) {
      const isPrefix = /^(?:tomorrow)/i.test(body);
      const rawHour = parseInt(isPrefix ? tomorrowTimeMatch[1] : tomorrowTimeMatch[2], 10);
      const rawMin = parseInt(isPrefix ? tomorrowTimeMatch[2] || "0" : tomorrowTimeMatch[3] || "0", 10);
      const meridiem = (isPrefix ? tomorrowTimeMatch[3] : tomorrowTimeMatch[4])?.toLowerCase();
      let prompt = (isPrefix ? tomorrowTimeMatch[4] : tomorrowTimeMatch[1]) || "Reminder";
      prompt = prompt.replace(/^(?:to|about|that)\s+/i, "").trim() || "Reminder";

      let hour = rawHour;
      if (meridiem === "pm" && hour < 12) hour += 12;
      if (meridiem === "am" && hour === 12) hour = 0;

      const dueAt = new Date(now);
      dueAt.setDate(dueAt.getDate() + 1);
      dueAt.setHours(hour, rawMin, 0, 0);

      return {
        isReminder: true,
        prompt,
        dueAt,
        humanReadableTime: `tomorrow at ${dueAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      };
    }

    // Pattern C: "at 5:30 pm [task]" or "[task] at 5pm" (today or tomorrow if time passed)
    const atTimeMatch =
      body.match(
        /^at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s+(?:to\s+|about\s+|that\s+)?(.*))?$/i,
      ) ||
      body.match(/^(.*?)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);

    if (atTimeMatch) {
      const isPrefix = /^at\s+\d+/i.test(body);
      const rawHour = parseInt(isPrefix ? atTimeMatch[1] : atTimeMatch[2], 10);
      const rawMin = parseInt(isPrefix ? atTimeMatch[2] || "0" : atTimeMatch[3] || "0", 10);
      const meridiem = (isPrefix ? atTimeMatch[3] : atTimeMatch[4])?.toLowerCase();
      let prompt = (isPrefix ? atTimeMatch[4] : atTimeMatch[1]) || "Reminder";
      prompt = prompt.replace(/^(?:to|about|that)\s+/i, "").trim() || "Reminder";

      let hour = rawHour;
      if (meridiem === "pm" && hour < 12) hour += 12;
      if (meridiem === "am" && hour === 12) hour = 0;

      const dueAt = new Date(now);
      dueAt.setHours(hour, rawMin, 0, 0);

      // If time has already passed today, roll over to tomorrow
      if (dueAt.getTime() <= now.getTime()) {
        dueAt.setDate(dueAt.getDate() + 1);
      }

      return {
        isReminder: true,
        prompt,
        dueAt,
        humanReadableTime: `${dueAt.getDate() === now.getDate() ? "today" : "tomorrow"} at ${dueAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      };
    }

    // Pattern D: "tonight at 8pm" or "tonight"
    if (/\btonight\b/i.test(body)) {
      let prompt = body.replace(/\btonight(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i, "").trim();
      prompt = prompt.replace(/^(?:to|about|that)\s+/i, "").trim() || "Reminder";

      const dueAt = new Date(now);
      dueAt.setHours(20, 0, 0, 0); // 8:00 PM default
      if (dueAt.getTime() <= now.getTime()) {
        dueAt.setHours(dueAt.getHours() + 2); // 2 hours later if already past 8pm
      }

      return {
        isReminder: true,
        prompt,
        dueAt,
        humanReadableTime: `tonight at ${dueAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      };
    }

    return null;
  }

  // =========================================================================
  // DATABASE PERSISTENCE
  // =========================================================================

  async createReminder(params: {
    telegramUserId: number;
    chatId: number;
    prompt: string;
    dueAt: Date;
  }): Promise<Reminder> {
    const [created] = await db
      .insert(remindersTable)
      .values({
        telegramUserId: params.telegramUserId,
        chatId: params.chatId,
        prompt: params.prompt,
        dueAt: params.dueAt,
        isCompleted: false,
        snoozeCount: 0,
      })
      .returning();

    logger.info(
      {
        reminderId: created?.id,
        telegramUserId: params.telegramUserId,
        dueAt: params.dueAt.toISOString(),
      },
      "Scheduled new proactive reminder",
    );

    return created;
  }

  async getActiveUserReminders(telegramUserId: number): Promise<Reminder[]> {
    return db
      .select()
      .from(remindersTable)
      .where(
        and(
          eq(remindersTable.telegramUserId, telegramUserId),
          eq(remindersTable.isCompleted, false),
        ),
      )
      .orderBy(desc(remindersTable.dueAt));
  }

  async completeReminder(reminderId: number, telegramUserId?: number): Promise<boolean> {
    const conditions = [eq(remindersTable.id, reminderId)];
    if (telegramUserId) {
      conditions.push(eq(remindersTable.telegramUserId, telegramUserId));
    }

    const updated = await db
      .update(remindersTable)
      .set({ isCompleted: true, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();

    if (updated.length > 0) {
      cdcService.dispatchReminderEvent({
        action: "UPDATE",
        id: updated[0].id,
        telegramUserId: updated[0].telegramUserId,
        chatId: updated[0].chatId,
        isCompleted: true,
        dueAt: updated[0].dueAt,
        prompt: updated[0].prompt,
        source: "manual_dispatch",
      });
      return true;
    }
    return false;
  }

  async snoozeReminder(
    reminderId: number,
    snoozeMinutes = 10,
    telegramUserId?: number,
  ): Promise<Reminder | null> {
    const conditions = [eq(remindersTable.id, reminderId)];
    if (telegramUserId) {
      conditions.push(eq(remindersTable.telegramUserId, telegramUserId));
    }

    const existing = await db
      .select()
      .from(remindersTable)
      .where(and(...conditions))
      .limit(1);

    if (!existing[0]) return null;

    const newDueAt = new Date(Date.now() + snoozeMinutes * 60 * 1000);
    const [updated] = await db
      .update(remindersTable)
      .set({
        dueAt: newDueAt,
        isCompleted: false,
        snoozeCount: (existing[0].snoozeCount || 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(remindersTable.id, reminderId))
      .returning();

    if (updated) {
      cdcService.dispatchReminderEvent({
        action: "UPDATE",
        id: updated.id,
        telegramUserId: updated.telegramUserId,
        chatId: updated.chatId,
        isCompleted: false,
        dueAt: updated.dueAt,
        prompt: updated.prompt,
        source: "manual_dispatch",
      });
    }

    return updated ?? null;
  }

  async cancelReminder(reminderId: number, telegramUserId: number): Promise<boolean> {
    const [deleted] = await db
      .delete(remindersTable)
      .where(
        and(
          eq(remindersTable.id, reminderId),
          eq(remindersTable.telegramUserId, telegramUserId),
        ),
      )
      .returning();

    if (deleted) {
      cdcService.dispatchReminderEvent({
        action: "DELETE",
        id: deleted.id,
        telegramUserId: deleted.telegramUserId,
        chatId: deleted.chatId,
        source: "manual_dispatch",
      });
      return true;
    }
    return false;
  }

  async fetchDueReminders(): Promise<Reminder[]> {
    const now = new Date();
    return db
      .select()
      .from(remindersTable)
      .where(
        and(
          eq(remindersTable.isCompleted, false),
          lte(remindersTable.dueAt, now),
        ),
      )
      .limit(20);
  }
}

export const reminderService = new ReminderService();

// =========================================================================
// BACKGROUND REMINDER SCHEDULER & DISPATCHER WITH REAL-TIME CDC LISTENER
// =========================================================================

export class ReminderScheduler {
  private timer?: NodeJS.Timeout;
  private isProcessing = false;
  private isCdcBound = false;
  private inFlightReminders = new Set<number>();

  start(bot: Bot): void {
    if (this.timer) return;

    logger.info("Starting background proactive reminder scheduler (10s interval)");
    this.timer = setInterval(() => {
      void this.tick(bot);
    }, 10_000);

    // Bind real-time change data capture listener
    if (!this.isCdcBound) {
      this.isCdcBound = true;

      // Start underlying PostgreSQL / Pulse CDC listener
      void cdcService.start();

      cdcService.on("reminder:completed", (event: ReminderCdcEvent) => {
        logger.info({ reminderId: event.id }, "[CDC] Received real-time reminder completion event");
        this.inFlightReminders.delete(event.id);
      });

      cdcService.on("reminder:cancelled", (event: ReminderCdcEvent) => {
        logger.info({ reminderId: event.id }, "[CDC] Received real-time reminder cancellation event");
        this.inFlightReminders.delete(event.id);
      });

      cdcService.on("reminder:created", (event: ReminderCdcEvent) => {
        logger.info({ reminderId: event.id }, "[CDC] Received real-time reminder creation event; triggering instant evaluation");
        void this.tick(bot);
      });

      cdcService.on("reminder:updated", (event: ReminderCdcEvent) => {
        logger.info({ reminderId: event.id }, "[CDC] Received real-time reminder update event; triggering instant evaluation");
        void this.tick(bot);
      });
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      logger.info("Stopped background proactive reminder scheduler");
    }
  }

  async tick(bot: Bot): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const dueReminders = await reminderService.fetchDueReminders();
      if (dueReminders.length === 0) return;

      for (const reminder of dueReminders) {
        if (this.inFlightReminders.has(reminder.id)) continue;
        this.inFlightReminders.add(reminder.id);

        try {
          // Immediately mark as completed in DB to avoid duplicate dispatch
          await reminderService.completeReminder(reminder.id);

          const timeFormatted = reminder.dueAt.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });

          const text =
            `⏰ <b>Reminder Notification!</b>\n\n` +
            `📌 <b>Task:</b> ${reminder.prompt}\n` +
            `🕒 <b>Scheduled for:</b> ${timeFormatted}` +
            (reminder.snoozeCount > 0 ? ` <i>(Snoozed ${reminder.snoozeCount}x)</i>` : "");

          await bot.api.sendMessage(reminder.chatId, text, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ Done", callback_data: `rem_done:${reminder.id}` },
                  { text: "⏰ Snooze 10m", callback_data: `rem_snooze:${reminder.id}:10` },
                  { text: "⏰ Snooze 1h", callback_data: `rem_snooze:${reminder.id}:60` },
                ],
              ],
            },
          });

          logger.info(
            { reminderId: reminder.id, chatId: reminder.chatId },
            "Dispatched due proactive reminder notification",
          );
        } catch (error) {
          logger.error(
            { reminderId: reminder.id, error: safeErrorMetadata(error) },
            "Failed delivering due reminder to Telegram chat",
          );
        }
      }
    } catch (error) {
      logger.warn(
        { error: safeErrorMetadata(error) },
        "Error during reminder scheduler tick",
      );
    } finally {
      this.isProcessing = false;
    }
  }
}

export const reminderScheduler = new ReminderScheduler();
