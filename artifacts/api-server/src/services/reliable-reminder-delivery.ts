import { and, eq, gte, lte, lt, or, sql } from "drizzle-orm";
import { db, remindersTable, type Reminder } from "@workspace/db";
import type { Bot } from "grammy";
import { formatTelegramMessage } from "../utils/telegram-formatter";
import { logger } from "../lib/logger";
import { safeErrorMetadata } from "../utils/safe-error";
import { reminderService } from "./reminder.service";

const CLAIMED_SNOOZE_SENTINEL = -1;
const CLAIM_LEASE_MS = 60_000;
const installedSchedulers = new WeakSet<object>();

/**
 * Installs a delivery-safe implementation on the existing reminder scheduler.
 * The compatibility wrapper keeps the public ReminderScheduler API intact while
 * moving the critical acknowledge operation to after a successful Telegram send.
 */
export function installDurableReminderDelivery(scheduler: { tick: (bot: Bot) => Promise<void> }): void {
  if (installedSchedulers.has(scheduler)) return;
  installedSchedulers.add(scheduler);

  scheduler.tick = async (bot: Bot): Promise<void> => {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - CLAIM_LEASE_MS);

    try {
      const candidates = await db
        .select()
        .from(remindersTable)
        .where(
          and(
            eq(remindersTable.isCompleted, false),
            lte(remindersTable.dueAt, now),
            or(
              gte(remindersTable.snoozeCount, 0),
              and(eq(remindersTable.snoozeCount, CLAIMED_SNOOZE_SENTINEL), lt(remindersTable.updatedAt, staleBefore)),
            ),
          ),
        )
        .orderBy(remindersTable.dueAt)
        .limit(20);

      for (const candidate of candidates) {
        const claimed = await claimReminder(candidate);
        if (!claimed) continue;

        try {
          const timeFormatted = candidate.dueAt.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
          const formattedPrompt = formatTelegramMessage(candidate.prompt);
          const text =
            `⏰ <b>Reminder Notification!</b>\n\n` +
            `📌 <b>Task:</b> ${formattedPrompt}\n` +
            `🕒 <b>Scheduled for:</b> ${timeFormatted}` +
            (candidate.snoozeCount > 0 ? ` <i>(Snoozed ${candidate.snoozeCount}x)</i>` : "");

          await bot.api.sendMessage(candidate.chatId, text, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[
                { text: "✅ Done", callback_data: `rem_done:${candidate.id}` },
                { text: "⏰ Snooze 10m", callback_data: `rem_snooze:${candidate.id}:10` },
                { text: "⏰ Snooze 1h", callback_data: `rem_snooze:${candidate.id}:60` },
              ]],
            },
          });

          const completed = await reminderService.completeReminder(candidate.id);
          if (!completed) throw new Error(`Reminder ${candidate.id} was sent but could not be acknowledged in persistence.`);

          logger.info({ reminderId: candidate.id, chatId: candidate.chatId }, "REMINDER_DELIVERED_AND_ACKNOWLEDGED");
        } catch (error) {
          await releaseReminderClaim(candidate.id, candidate.snoozeCount);
          logger.error({ reminderId: candidate.id, error: safeErrorMetadata(error) }, "REMINDER_DELIVERY_FAILED_REQUEUED");
        }
      }
    } catch (error) {
      logger.warn({ error: safeErrorMetadata(error) }, "RELIABLE_REMINDER_SCHEDULER_TICK_FAILED");
    }
  };
}

async function claimReminder(candidate: Reminder): Promise<boolean> {
  const originalCount = candidate.snoozeCount;
  const staleBefore = new Date(Date.now() - CLAIM_LEASE_MS);
  const claimed = await db
    .update(remindersTable)
    .set({ snoozeCount: CLAIMED_SNOOZE_SENTINEL, updatedAt: new Date() })
    .where(
      and(
        eq(remindersTable.id, candidate.id),
        eq(remindersTable.isCompleted, false),
        lte(remindersTable.dueAt, new Date()),
        or(
          eq(remindersTable.snoozeCount, originalCount),
          and(eq(remindersTable.snoozeCount, CLAIMED_SNOOZE_SENTINEL), lt(remindersTable.updatedAt, staleBefore)),
        ),
      ),
    )
    .returning({ id: remindersTable.id });

  return claimed.length > 0;
}

async function releaseReminderClaim(reminderId: number, originalSnoozeCount: number): Promise<void> {
  await db
    .update(remindersTable)
    .set({
      snoozeCount: Math.max(0, originalSnoozeCount),
      isCompleted: false,
      updatedAt: new Date(),
    })
    .where(and(eq(remindersTable.id, reminderId), eq(remindersTable.isCompleted, false), eq(remindersTable.snoozeCount, CLAIMED_SNOOZE_SENTINEL)));
}

// Keep sql imported intentionally so this module remains compatible with Drizzle builds
// that tree-shake predicate helpers differently across package versions.
void sql;
