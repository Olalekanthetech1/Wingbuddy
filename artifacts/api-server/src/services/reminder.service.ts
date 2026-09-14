import { and, desc, eq, lte } from "drizzle-orm";
import { db, remindersTable, usersTable, type Reminder, cdcService, type ReminderCdcEvent } from "@workspace/db";
import { logger } from "../lib/logger";
import { safeErrorMetadata } from "../utils/safe-error";
import { formatTelegramMessage } from "../utils/telegram-formatter";
import { InlineKeyboard, type Bot } from "grammy";
import cronParser from "cron-parser";
const { parseExpression } = cronParser;
import { timezoneService } from "./timezone.service";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export type ReminderCategory = "Work Routine" | "Research Digest" | "Personal Reminder" | "Simple Alert";

export interface ReminderClassification {
  category: ReminderCategory;
  icon: string;
  greeting: string;
}

export interface ParsedReminder {
  isReminder: boolean;
  prompt: string;
  dueAt: Date;
  humanReadableTime: string;
  isRecurring?: boolean;
  cronExpression?: string;
  cadenceDescription?: string;
  category?: ReminderCategory;
  icon?: string;
  contextualGreeting?: string;
}

export class ReminderService {
  /**
   * Formats a Date object into standard "YYYY-MM-DD HH:mm:ss UTC"
   */
  static formatUtcTimestamp(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mm = String(date.getUTCMinutes()).padStart(2, "0");
    const ss = String(date.getUTCSeconds()).padStart(2, "0");
    return `${y}-${m}-${d} ${hh}:${mm}:${ss} UTC`;
  }

  /**
   * Intelligently classifies a task into Work Routine, Research Digest, Personal, or Simple Alert,
   * and provides a tailored contextual greeting based on type and time of day.
   */
  static classifyReminderType(text: string, hourUtc?: number): ReminderClassification {
    const lower = text.toLowerCase();

    const isResearch =
      /job|search|vacanc|career|linkedin|internship|hiring|digest|briefing|research|market|competitor|leads|news|trends/i.test(
        lower,
      );

    const isWork =
      /admin|dashboard|meeting|call|deploy|review|work|client|email|standup|task|project|code|invoice|report|sync|jira|github|pr\b|pull request|metrics|analytics|presentation|budget|contract|sprint/i.test(
        lower,
      );

    const isPersonal =
      /medicine|pill|water|lunch|dinner|breakfast|workout|gym|exercise|sleep|bed|mom|dad|family|wife|husband|kid|buy|groceries|dog|walk|break|rest|breathe|meditat|health|doctor|dentist/i.test(
        lower,
      );

    let category: ReminderCategory = "Simple Alert";
    let icon = "🔔";

    if (isResearch) {
      category = "Research Digest";
      icon = "🌍";
    } else if (isWork) {
      category = "Work Routine";
      icon = "📊";
    } else if (isPersonal) {
      category = "Personal Reminder";
      icon = "🔔";
    }

    // Determine Contextual Greeting
    let greeting = "Got it! 🎉";
    if (hourUtc !== undefined && hourUtc >= 5 && hourUtc <= 11) {
      greeting = isWork ? "Good morning 🌅, here’s your dashboard check." : "Good morning 🌅!";
    } else if (isWork) {
      greeting = "All set 💼!";
    } else if (isPersonal) {
      greeting = "Don’t worry ❤️, I’ll remind you.";
    }

    return { category, icon, greeting };
  }

  /**
   * Generates the Refined Reminder Confirmation Card
   */
  static formatReminderConfirmationCard(params: {
    greeting?: string;
    title: string;
    when: string;
    nextTrigger: Date;
    category: ReminderCategory;
    icon: string;
    isRecurring?: boolean;
  }): string {
    const greeting = params.greeting || "All set 💼!";
    const nextTriggerStr = this.formatUtcTimestamp(params.nextTrigger);
    const frequencyLabel = params.isRecurring ? "daily" : "notification";

    return [
      `<b>${greeting}</b>`,
      ``,
      `✅ <b>Reminder set:</b> “${escapeHtml(params.title)}”`,
      `📅 <b>When:</b> ${escapeHtml(params.when)}`,
      `🕒 <b>Next trigger:</b> <code>${nextTriggerStr}</code>`,
      `${params.icon} <b>Type:</b> ${params.category}`,
      ``,
      `You’ll get a ${frequencyLabel} notification with quick actions:`,
    ].join("\n");
  }

  /**
   * Quick actions keyboard attached to Reminder Confirmations and Triggered Alerts
   */
  static reminderActionsKeyboard(targetId: number, targetType: "rem" | "sched" = "rem"): InlineKeyboard {
    const prefix = targetType === "sched" ? "sched" : "rem";
    return new InlineKeyboard()
      .text("⏰ Snooze 15m", `${prefix}_snooze:${targetId}:15`)
      .text("⏰ Snooze 1h", `${prefix}_snooze:${targetId}:60`)
      .text("✅ Mark Done", `${prefix}_done:${targetId}`)
      .row()
      .text("✏️ Edit Time", `${prefix}_edit:${targetId}`)
      .text("❌ Cancel", `${prefix}_cancel:${targetId}`);
  }

  /**
   * Intelligently parses natural language text for reminder intents and due dates.
   * Handles recurring patterns ("every day at 9 AM", "daily at 9am", "every weekday at 9am"),
   * relative durations ("in 15 mins", "in 2 hours"), specific clock times
   * ("at 4:30 pm", "tomorrow at 9am"), and keywords.
   */
  static parseNaturalReminder(
    text: string,
    now: Date = new Date(),
    timezone: string = "UTC",
  ): ParsedReminder | null {
    const trimmed = text.trim();

    // 1. Check for reminder trigger prefixes
    const triggerMatch = trimmed.match(
      /^(?:\/remind(?:er)?\b\s*|remind\s+me\s+(?:to\s+|about\s+|that\s+)?|set\s+(?:a\s+)?reminder\s*(?::\s*|\s+(?:to\s+|for\s+)?)|reminder:\s*)/i,
    );

    const isCommand = /^\/remind(?:er)?\b/i.test(trimmed);
    if (!triggerMatch && !isCommand) {
      // Also check for embedded "remind me in X to Y" or "remind me every day at X to Y"
      const embeddedMatch = trimmed.match(/\bremind\s+me\s+/i);
      if (!embeddedMatch) {
        // Also check if text begins with "every day at ..." or "daily at ..."
        const directRecurringMatch = trimmed.match(/^(?:every\s+day|daily|every\s+morning|every\s+weekday|every\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\s+at\s+/i);
        if (!directRecurringMatch) return null;
      }
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

    // Remove wrapping quotes if present
    body = body.replace(/^["“](.*?)["”]/, "$1").trim();

    if (!body) return null;

    // Pattern R1: "every day at 9am [task]" or "[task] every day at 9am" or "daily at 9am [task]"
    const dailyMatch =
      body.match(
        /^(?:every\s+day\s+at\s+|daily\s+at\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(?:to\s+|about\s+|that\s+)?(.*))?$/i,
      ) ||
      body.match(
        /^(.*?)\s+(?:every\s+day\s+at\s+|daily\s+at\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
      );

    if (dailyMatch) {
      const isPrefix = /^(?:every\s+day|daily)/i.test(body);
      const rawHour = parseInt(isPrefix ? dailyMatch[1] : dailyMatch[2], 10);
      const rawMin = parseInt(isPrefix ? dailyMatch[2] || "0" : dailyMatch[3] || "0", 10);
      const meridiem = (isPrefix ? dailyMatch[3] : dailyMatch[4])?.toLowerCase();
      let prompt = (isPrefix ? dailyMatch[4] : dailyMatch[1]) || "Check Admin Dashboard";
      prompt = prompt.replace(/^(?:to|about|that)\s+/i, "").replace(/^["“]|["”]$/g, "").trim() || "Reminder";

      let hour = rawHour;
      if (meridiem === "pm" && hour < 12) hour += 12;
      if (meridiem === "am" && hour === 12) hour = 0;

      const cronExpression = `${rawMin} ${hour} * * *`;
      let dueAt = new Date(now);
      try {
        const interval = parseExpression(cronExpression, { currentDate: now, tz: timezone });
        dueAt = interval.next().toDate();
      } catch {
        dueAt = timezoneService.calculateNextOccurrenceUtc(`${String(hour).padStart(2, "0")}:${String(rawMin).padStart(2, "0")}`, timezone, now);
      }

      const hour12 = hour % 12 === 0 ? 12 : hour % 12;
      const ampm = hour >= 12 ? "PM" : "AM";
      const minStr = rawMin > 0 ? `:${String(rawMin).padStart(2, "0")}` : "";
      const cadenceDescription = `Every day at ${hour12}${minStr} ${ampm}`;

      const classification = ReminderService.classifyReminderType(prompt, hour);

      return {
        isReminder: true,
        prompt,
        dueAt,
        humanReadableTime: cadenceDescription,
        isRecurring: true,
        cronExpression,
        cadenceDescription,
        category: classification.category,
        icon: classification.icon,
        contextualGreeting: classification.greeting,
      };
    }

    // Pattern R2: "every weekday at 9am [task]" or "[task] every weekday at 9am"
    const weekdayMatch =
      body.match(
        /^(?:every\s+weekday\s+at\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(?:to\s+|about\s+|that\s+)?(.*))?$/i,
      ) ||
      body.match(
        /^(.*?)\s+(?:every\s+weekday\s+at\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
      );

    if (weekdayMatch) {
      const isPrefix = /^every\s+weekday/i.test(body);
      const rawHour = parseInt(isPrefix ? weekdayMatch[1] : weekdayMatch[2], 10);
      const rawMin = parseInt(isPrefix ? weekdayMatch[2] || "0" : weekdayMatch[3] || "0", 10);
      const meridiem = (isPrefix ? weekdayMatch[3] : weekdayMatch[4])?.toLowerCase();
      let prompt = (isPrefix ? weekdayMatch[4] : weekdayMatch[1]) || "Task";
      prompt = prompt.replace(/^(?:to|about|that)\s+/i, "").replace(/^["“]|["”]$/g, "").trim() || "Reminder";

      let hour = rawHour;
      if (meridiem === "pm" && hour < 12) hour += 12;
      if (meridiem === "am" && hour === 12) hour = 0;

      const cronExpression = `${rawMin} ${hour} * * 1-5`;
      let dueAt = new Date(now);
      try {
        const interval = parseExpression(cronExpression, { currentDate: now, tz: timezone });
        dueAt = interval.next().toDate();
      } catch {
        dueAt = new Date(now.getTime() + 86400000);
      }

      const hour12 = hour % 12 === 0 ? 12 : hour % 12;
      const ampm = hour >= 12 ? "PM" : "AM";
      const minStr = rawMin > 0 ? `:${String(rawMin).padStart(2, "0")}` : "";
      const cadenceDescription = `Every weekday at ${hour12}${minStr} ${ampm}`;

      const classification = ReminderService.classifyReminderType(prompt, hour);

      return {
        isReminder: true,
        prompt,
        dueAt,
        humanReadableTime: cadenceDescription,
        isRecurring: true,
        cronExpression,
        cadenceDescription,
        category: classification.category,
        icon: classification.icon,
        contextualGreeting: classification.greeting,
      };
    }

    // Pattern R3: "every [day of week] at 9am [task]"
    const dayOfWeekMatch =
      body.match(
        /^(?:every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(?:to\s+|about\s+|that\s+)?(.*))?$/i,
      ) ||
      body.match(
        /^(.*?)\s+(?:every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
      );

    if (dayOfWeekMatch) {
      const isPrefix = /^every\s+(?:mon|tue|wed|thu|fri|sat|sun)/i.test(body);
      const dayName = (isPrefix ? dayOfWeekMatch[1] : dayOfWeekMatch[2]).toLowerCase();
      const rawHour = parseInt(isPrefix ? dayOfWeekMatch[2] : dayOfWeekMatch[3], 10);
      const rawMin = parseInt(isPrefix ? dayOfWeekMatch[3] || "0" : dayOfWeekMatch[4] || "0", 10);
      const meridiem = (isPrefix ? dayOfWeekMatch[4] : dayOfWeekMatch[5])?.toLowerCase();
      let prompt = (isPrefix ? dayOfWeekMatch[5] : dayOfWeekMatch[1]) || "Weekly Task";
      prompt = prompt.replace(/^(?:to|about|that)\s+/i, "").replace(/^["“]|["”]$/g, "").trim() || "Reminder";

      let hour = rawHour;
      if (meridiem === "pm" && hour < 12) hour += 12;
      if (meridiem === "am" && hour === 12) hour = 0;

      const dayMap: Record<string, number> = {
        sunday: 0,
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6,
      };
      const dayNum = dayMap[dayName] ?? 1;

      const cronExpression = `${rawMin} ${hour} * * ${dayNum}`;
      let dueAt = new Date(now);
      try {
        const interval = parseExpression(cronExpression, { currentDate: now, tz: timezone });
        dueAt = interval.next().toDate();
      } catch {
        dueAt = new Date(now.getTime() + 7 * 86400000);
      }

      const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
      const hour12 = hour % 12 === 0 ? 12 : hour % 12;
      const ampm = hour >= 12 ? "PM" : "AM";
      const minStr = rawMin > 0 ? `:${String(rawMin).padStart(2, "0")}` : "";
      const cadenceDescription = `Every ${capitalizedDay} at ${hour12}${minStr} ${ampm}`;

      const classification = ReminderService.classifyReminderType(prompt, hour);

      return {
        isReminder: true,
        prompt,
        dueAt,
        humanReadableTime: cadenceDescription,
        isRecurring: true,
        cronExpression,
        cadenceDescription,
        category: classification.category,
        icon: classification.icon,
        contextualGreeting: classification.greeting,
      };
    }

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
      const classification = ReminderService.classifyReminderType(prompt, dueAt.getUTCHours());
      return {
        isReminder: true,
        prompt,
        dueAt,
        humanReadableTime: `in ${amount} ${unitLabel} (${dueAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`,
        category: classification.category,
        icon: classification.icon,
        contextualGreeting: classification.greeting,
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

      const timeHHMM = `${String(hour).padStart(2, "0")}:${String(rawMin).padStart(2, "0")}`;
      const tomorrowRef = new Date(now.getTime() + 86400000);
      const dueAt = timezoneService.calculateNextOccurrenceUtc(timeHHMM, timezone, tomorrowRef);

      const classification = ReminderService.classifyReminderType(prompt, hour);

      return {
        isReminder: true,
        prompt,
        dueAt,
        humanReadableTime: `tomorrow at ${timeHHMM}`,
        category: classification.category,
        icon: classification.icon,
        contextualGreeting: classification.greeting,
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

      const timeHHMM = `${String(hour).padStart(2, "0")}:${String(rawMin).padStart(2, "0")}`;
      const dueAt = timezoneService.calculateNextOccurrenceUtc(timeHHMM, timezone, now);

      const classification = ReminderService.classifyReminderType(prompt, hour);

      return {
        isReminder: true,
        prompt,
        dueAt,
        humanReadableTime: `at ${timeHHMM}`,
        category: classification.category,
        icon: classification.icon,
        contextualGreeting: classification.greeting,
      };
    }

    // Pattern D: "tonight at 8pm" or "tonight"
    if (/\btonight\b/i.test(body)) {
      let prompt = body.replace(/\btonight(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i, "").trim();
      prompt = prompt.replace(/^(?:to|about|that)\s+/i, "").trim() || "Reminder";

      const dueAt = timezoneService.calculateNextOccurrenceUtc("20:00", timezone, now);

      const classification = ReminderService.classifyReminderType(prompt, 20);

      return {
        isReminder: true,
        prompt,
        dueAt,
        humanReadableTime: "tonight at 20:00",
        category: classification.category,
        icon: classification.icon,
        contextualGreeting: classification.greeting,
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
    await db
      .insert(usersTable)
      .values({
        telegramUserId: params.telegramUserId,
        firstName: "Dashboard User",
        personality: "playful",
        mode: "general",
      })
      .onConflictDoNothing();

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
          const nowUtc = ReminderService.formatUtcTimestamp(new Date());
          const classification = ReminderService.classifyReminderType(reminder.prompt);
          const historyLine =
            reminder.snoozeCount > 0
              ? `📈 <b>Run History:</b> Snoozed ${reminder.snoozeCount}x • Last trigger: ${timeFormatted}`
              : `📈 <b>Run History:</b> Fired 1 time this week`;

          const text = [
            `⏰ <b>Reminder Alert: “${escapeHtml(reminder.prompt)}”</b>`,
            ``,
            `📅 <b>Scheduled:</b> ${timeFormatted}`,
            `🕒 <b>Triggered:</b> <code>${nowUtc}</code>`,
            `${classification.icon} <b>Type:</b> ${classification.category}`,
            historyLine,
            ``,
            `<b>Actions:</b>`,
          ].join("\n");

          await bot.api.sendMessage(reminder.chatId, text, {
            parse_mode: "HTML",
            reply_markup: ReminderService.reminderActionsKeyboard(reminder.id, "rem"),
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
