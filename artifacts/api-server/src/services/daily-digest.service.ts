import { PrismaClient } from "@prisma/client";
import { getPool } from "@workspace/db";
import { InlineKeyboard } from "grammy";
import { logger } from "../lib/logger";

const prisma = new PrismaClient();

function escapeHtml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface DigestPreferences {
  enabled: boolean;
  sendTime: string; // "HH:mm"
  timezone: string; // IANA e.g. "UTC", "Africa/Lagos", "Europe/London"
  sections: string[]; // ["tasks", "reminders", "goals"]
  days: string[]; // ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
  whenEmpty: "message" | "skip";
  includeWeeklySummary: boolean;
  pausedUntil: Date | null;
  lastSentAt?: Date | null;
  lastStatus?: string | null;
  lastItemCount?: number;
}

export interface DigestBuildResult {
  shouldSkip: boolean;
  itemCount: number;
  sectionsIncluded: string[];
  htmlText: string;
  keyboard?: InlineKeyboard;
  metadata: {
    tasksCount: number;
    overdueTasksCount: number;
    remindersCount: number;
    goalsCount: number;
    timezone: string;
    deliveryDate: string;
  };
}

export class DailyDigestService {
  /**
   * Validate that a timezone string is a valid IANA timezone.
   * Returns "UTC" if invalid or empty.
   */
  public sanitizeTimezone(tz?: string | null): string {
    if (!tz || typeof tz !== "string" || !tz.trim()) return "UTC";
    const cleaned = tz.trim();
    try {
      Intl.DateTimeFormat(undefined, { timeZone: cleaned });
      return cleaned;
    } catch {
      return "UTC";
    }
  }

  /**
   * Fetch or initialize user preferences from database.
   */
  public async getPreferences(telegramUserId: number | bigint): Promise<DigestPreferences> {
    const tgId = BigInt(telegramUserId);

    // 1. Check existing preferences
    const pref = await prisma.userDailyDigestPreference.findUnique({
      where: { telegramUserId: tgId },
    });

    // 2. Fetch last delivery record for audit/display
    const lastDelivery = await prisma.dailyDigestDelivery.findFirst({
      where: { telegramUserId: tgId },
      orderBy: { createdAt: "desc" },
    });

    if (pref) {
      let sections: string[] = ["tasks", "reminders", "goals"];
      let days: string[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
      try {
        sections = JSON.parse(pref.sections);
      } catch {}
      try {
        days = JSON.parse(pref.days);
      } catch {}

      return {
        enabled: pref.enabled,
        sendTime: pref.sendTime || "08:00",
        timezone: this.sanitizeTimezone(pref.timezone),
        sections,
        days,
        whenEmpty: (pref.whenEmpty as any) || "skip",
        includeWeeklySummary: pref.includeWeeklySummary,
        pausedUntil: pref.pausedUntil,
        lastSentAt: lastDelivery?.deliveredAt || null,
        lastStatus: lastDelivery?.status || null,
        lastItemCount: lastDelivery?.itemCount || 0,
      };
    }

    // Check user_timezones table for any onboarding timezone, else default to UTC
    let userTz = "UTC";
    try {
      const pool = getPool();
      const tzRes = await pool.query(
        `SELECT timezone FROM user_timezones WHERE telegram_user_id = $1 LIMIT 1`,
        [tgId.toString()]
      );
      if (tzRes.rows.length > 0 && tzRes.rows[0].timezone) {
        userTz = this.sanitizeTimezone(tzRes.rows[0].timezone);
      }
    } catch {}

    // Initialize default row
    const created = await prisma.userDailyDigestPreference.create({
      data: {
        telegramUserId: tgId,
        enabled: true,
        sendTime: "08:00",
        timezone: userTz,
        sections: JSON.stringify(["tasks", "reminders", "goals"]),
        days: JSON.stringify(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
        whenEmpty: "skip",
        includeWeeklySummary: false,
      },
    });

    return {
      enabled: created.enabled,
      sendTime: created.sendTime,
      timezone: this.sanitizeTimezone(created.timezone),
      sections: ["tasks", "reminders", "goals"],
      days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      whenEmpty: "skip",
      includeWeeklySummary: false,
      pausedUntil: null,
      lastSentAt: null,
      lastStatus: null,
      lastItemCount: 0,
    };
  }

  /**
   * Update user digest preferences.
   */
  public async updatePreferences(
    telegramUserId: number | bigint,
    updates: Partial<DigestPreferences>
  ): Promise<DigestPreferences> {
    const tgId = BigInt(telegramUserId);
    const existing = await this.getPreferences(tgId);

    const timezone = updates.timezone ? this.sanitizeTimezone(updates.timezone) : existing.timezone;
    const sendTime = updates.sendTime || existing.sendTime;
    const enabled = updates.enabled !== undefined ? updates.enabled : existing.enabled;
    const sections = updates.sections ? JSON.stringify(updates.sections) : JSON.stringify(existing.sections);
    const days = updates.days ? JSON.stringify(updates.days) : JSON.stringify(existing.days);
    const whenEmpty = updates.whenEmpty || existing.whenEmpty;
    const includeWeeklySummary =
      updates.includeWeeklySummary !== undefined
        ? updates.includeWeeklySummary
        : existing.includeWeeklySummary;

    await prisma.userDailyDigestPreference.upsert({
      where: { telegramUserId: tgId },
      update: {
        enabled,
        sendTime,
        timezone,
        sections,
        days,
        whenEmpty,
        includeWeeklySummary,
        pausedUntil: updates.pausedUntil !== undefined ? updates.pausedUntil : existing.pausedUntil,
      },
      create: {
        telegramUserId: tgId,
        enabled,
        sendTime,
        timezone,
        sections,
        days,
        whenEmpty,
        includeWeeklySummary,
        pausedUntil: updates.pausedUntil !== undefined ? updates.pausedUntil : existing.pausedUntil,
      },
    });

    return this.getPreferences(tgId);
  }

  /**
   * Pure Deterministic Digest Builder.
   * Strictly adheres to Zero-Fallback Policy:
   * - Real queries for tasks, reminders, and goals.
   * - Emits ONLY sections that have real data.
   * - Never fabricates fake quotes or simulated examples.
   */
  public async buildDigest(
    telegramUserId: number | bigint,
    options?: { forceIncludeAllSections?: boolean; forceSend?: boolean }
  ): Promise<DigestBuildResult> {
    const tgId = BigInt(telegramUserId);
    const prefs = await this.getPreferences(tgId);
    const tz = prefs.timezone || "UTC";

    // 1. Calculate local date and time bounds in user's IANA timezone
    const now = new Date();
    const formatterDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const deliveryDate = formatterDate.format(now); // "YYYY-MM-DD"

    const headerDateFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const headerDateStr = headerDateFormatter.format(now);

    const sectionsToInclude = prefs.sections || ["tasks", "reminders", "goals"];

    // 2. Fetch Tasks (Strict DB query)
    const overdueTasks: Array<{ id: number; title: string; deadlineAt: Date | null }> = [];
    const todayTasks: Array<{ id: number; title: string; deadlineAt: Date | null; status: string }> = [];

    if (sectionsToInclude.includes("tasks") || options?.forceIncludeAllSections) {
      const tasks = await prisma.agentTask.findMany({
        where: {
          telegramUserId: tgId,
          status: { in: ["pending", "in_progress", "active", "needs_approval", "blocked"] },
        },
        orderBy: [{ nextRunAt: "asc" }, { updatedAt: "desc" }],
        take: 10,
      });

      for (const t of tasks) {
        if (t.nextRunAt && t.nextRunAt < now) {
          overdueTasks.push({ id: t.id, title: t.title, deadlineAt: t.nextRunAt });
        } else {
          todayTasks.push({ id: t.id, title: t.title, deadlineAt: t.nextRunAt, status: t.status });
        }
      }
    }

    // 3. Fetch Reminders (Strict DB query)
    const dueReminders: Array<{ id: number; prompt: string; dueAt: Date }> = [];
    if (sectionsToInclude.includes("reminders") || options?.forceIncludeAllSections) {
      const reminders = await prisma.reminder.findMany({
        where: {
          telegramUserId: tgId,
          isCompleted: false,
        },
        orderBy: { dueAt: "asc" },
        take: 8,
      });

      for (const r of reminders) {
        dueReminders.push({ id: r.id, prompt: r.prompt, dueAt: r.dueAt });
      }
    }

    // 4. Fetch Goals (Strict DB query on genuine strategic goals & milestones)
    const activeGoals: Array<{ id: number; title: string; goal: string; status: string }> = [];
    if (sectionsToInclude.includes("goals") || options?.forceIncludeAllSections) {
      const goals = await prisma.agentTask.findMany({
        where: {
          telegramUserId: tgId,
          OR: [
            { title: { contains: "savings", mode: "insensitive" } },
            { title: { contains: "strategy", mode: "insensitive" } },
            { title: { contains: "goal", mode: "insensitive" } },
            { goal: { contains: "savings", mode: "insensitive" } },
            { goal: { contains: "milestone", mode: "insensitive" } },
          ],
          status: { notIn: ["cancelled"] },
        },
        orderBy: { updatedAt: "desc" },
        take: 4,
      });

      for (const g of goals) {
        activeGoals.push({ id: g.id, title: g.title, goal: g.goal, status: g.status });
      }
    }

    // 5. Calculate total real items
    const tasksCount = overdueTasks.length + todayTasks.length;
    const remindersCount = dueReminders.length;
    const goalsCount = activeGoals.length;
    const totalItems = tasksCount + remindersCount + goalsCount;

    // 6. Check empty state
    if (totalItems === 0) {
      if (prefs.whenEmpty === "skip" && !options?.forceSend) {
        return {
          shouldSkip: true,
          itemCount: 0,
          sectionsIncluded: [],
          htmlText: "",
          metadata: {
            tasksCount: 0,
            overdueTasksCount: 0,
            remindersCount: 0,
            goalsCount: 0,
            timezone: tz,
            deliveryDate,
          },
        };
      }

      // Empty message mode
      const emptyText = [
        `🌅 <b>Daily Executive Briefing</b>`,
        `📅 <i>${escapeHtml(headerDateStr)} (${escapeHtml(tz)})</i>`,
        ``,
        `✨ <b>Nothing scheduled today</b> — you have no pending tasks, active reminders, or open goal milestones.`,
      ].join("\n");

      const emptyKeyboard = new InlineKeyboard()
        .text("➕ Add Task", "menu:chat")
        .text("⏰ Set Reminder", "menu:chat");

      return {
        shouldSkip: false,
        itemCount: 0,
        sectionsIncluded: [],
        htmlText: emptyText,
        keyboard: emptyKeyboard,
        metadata: {
          tasksCount: 0,
          overdueTasksCount: 0,
          remindersCount: 0,
          goalsCount: 0,
          timezone: tz,
          deliveryDate,
        },
      };
    }

    // 7. Compose Digest with ONLY non-empty sections
    const lines: string[] = [
      `🌅 <b>Daily Executive Briefing</b>`,
      `📅 <i>${escapeHtml(headerDateStr)} (${escapeHtml(tz)})</i>`,
      ``,
    ];

    const sectionsIncluded: string[] = [];
    const keyboard = new InlineKeyboard();

    // SECTION A: Overdue Tasks
    if (overdueTasks.length > 0) {
      sectionsIncluded.push("overdue_tasks");
      lines.push(`🚨 <b>Overdue Tasks (${overdueTasks.length})</b>`);
      for (const ot of overdueTasks) {
        const timeFormatted = ot.deadlineAt
          ? new Intl.DateTimeFormat("en-US", {
              timeZone: tz,
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }).format(ot.deadlineAt)
          : "Overdue";
        lines.push(`• <b>${escapeHtml(ot.title)}</b> — <i>due ${escapeHtml(timeFormatted)}</i>`);
      }
      lines.push(``);
    }

    // SECTION B: Today's Priorities / Active Tasks
    if (todayTasks.length > 0) {
      sectionsIncluded.push("tasks");
      lines.push(`⚡ <b>Active Tasks (${todayTasks.length})</b>`);
      for (const tt of todayTasks) {
        lines.push(`• <b>${escapeHtml(tt.title)}</b>`);
      }
      lines.push(``);
    }

    // SECTION C: Today's Reminders
    if (dueReminders.length > 0) {
      sectionsIncluded.push("reminders");
      lines.push(`⏰ <b>Today’s Reminders (${dueReminders.length})</b>`);
      for (const r of dueReminders) {
        const reminderTime = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          hour: "2-digit",
          minute: "2-digit",
        }).format(r.dueAt);
        lines.push(`• <b>${escapeHtml(reminderTime)}</b> — ${escapeHtml(r.prompt)}`);
      }
      lines.push(``);
    }

    // SECTION D: Active Goals & Real Progress
    if (activeGoals.length > 0) {
      sectionsIncluded.push("goals");
      lines.push(`🎯 <b>Strategic Goals & Milestones</b>`);
      for (const g of activeGoals) {
        lines.push(`• <b>${escapeHtml(g.title)}</b>`);
        if (g.goal && g.goal.length > 0) {
          lines.push(`  <i>${escapeHtml(g.goal.slice(0, 120))}${g.goal.length > 120 ? "..." : ""}</i>`);
        }
      }
      lines.push(``);
    }

    // Deterministic Closing Line (Ground truth only: point to the top priority)
    if (overdueTasks.length > 0) {
      lines.push(`💡 <i>Primary focus today: ${escapeHtml(overdueTasks[0].title)}</i>`);
    } else if (todayTasks.length > 0) {
      lines.push(`💡 <i>Primary focus today: ${escapeHtml(todayTasks[0].title)}</i>`);
    } else if (dueReminders.length > 0) {
      lines.push(`💡 <i>First action today: ${escapeHtml(dueReminders[0].prompt)}</i>`);
    }

    // Interactive Action Buttons
    let addedButtons = 0;
    if (overdueTasks.length > 0) {
      keyboard.text(`✅ Done: #${overdueTasks[0].id}`, `digest:done:task:${overdueTasks[0].id}`);
      addedButtons++;
    } else if (todayTasks.length > 0) {
      keyboard.text(`✅ Done: #${todayTasks[0].id}`, `digest:done:task:${todayTasks[0].id}`);
      addedButtons++;
    }

    if (dueReminders.length > 0) {
      keyboard.text(`⏰ Snooze 1h`, `digest:snooze:rem:${dueReminders[0].id}:60`);
      addedButtons++;
    }

    if (addedButtons > 0) keyboard.row();

    // Standard control row
    keyboard
      .url("🌐 Open in Web", `https://${process.env.REPL_SLUG ? process.env.REPL_SLUG + ".replit.app" : "wingbuddy.ai"}`)
      .text("⚙️ Settings", "digest:settings");

    return {
      shouldSkip: false,
      itemCount: totalItems,
      sectionsIncluded,
      htmlText: lines.join("\n"),
      keyboard,
      metadata: {
        tasksCount,
        overdueTasksCount: overdueTasks.length,
        remindersCount,
        goalsCount,
        timezone: tz,
        deliveryDate,
      },
    };
  }

  /**
   * Send today's digest now for a user (used by /digest command and Web UI trigger).
   */
  public async sendDigestNow(
    telegramUserId: number | bigint,
    forceSend = true,
    botApi?: any
  ): Promise<{ success: boolean; message: string; itemCount: number }> {
    const tgId = BigInt(telegramUserId);
    const digest = await this.buildDigest(tgId, { forceSend });

    if (digest.shouldSkip) {
      return {
        success: true,
        message: "No scheduled items for today; digest skipped per empty-content policy.",
        itemCount: 0,
      };
    }

    // Resolve active bot
    let bot = botApi;
    if (!bot) {
      try {
        const { telegramRuntime } = await import("./telegram-runtime.service");
        bot = telegramRuntime.bot?.api;
      } catch {}
    }

    if (!bot) {
      return {
        success: false,
        message: "Telegram Bot API is currently offline or not initialized.",
        itemCount: digest.itemCount,
      };
    }

    try {
      await bot.sendMessage(Number(tgId), digest.htmlText, {
        parse_mode: "HTML",
        reply_markup: digest.keyboard,
      });

      // Record successful delivery
      await prisma.dailyDigestDelivery.upsert({
        where: {
          telegramUserId_deliveryDate: {
            telegramUserId: tgId,
            deliveryDate: digest.metadata.deliveryDate,
          },
        },
        update: {
          status: "delivered",
          deliveredAt: new Date(),
          sectionsIncluded: JSON.stringify(digest.sectionsIncluded),
          itemCount: digest.itemCount,
          summaryText: digest.htmlText.slice(0, 500),
          errorMessage: null,
        },
        create: {
          telegramUserId: tgId,
          deliveryDate: digest.metadata.deliveryDate,
          scheduledFor: new Date(),
          deliveredAt: new Date(),
          status: "delivered",
          sectionsIncluded: JSON.stringify(digest.sectionsIncluded),
          itemCount: digest.itemCount,
          summaryText: digest.htmlText.slice(0, 500),
        },
      });

      return {
        success: true,
        message: `Digest sent successfully with ${digest.itemCount} item(s).`,
        itemCount: digest.itemCount,
      };
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      const isBlocked = err?.error_code === 403 || errMsg.includes("blocked by the user");

      if (isBlocked) {
        logger.warn({ telegramUserId: tgId.toString() }, "Telegram user blocked the bot; disabling digest");
        await prisma.userDailyDigestPreference.update({
          where: { telegramUserId: tgId },
          data: { enabled: false },
        });
      }

      await prisma.dailyDigestDelivery.upsert({
        where: {
          telegramUserId_deliveryDate: {
            telegramUserId: tgId,
            deliveryDate: digest.metadata.deliveryDate,
          },
        },
        update: {
          status: "failed",
          errorMessage: errMsg,
          retryCount: { increment: 1 },
        },
        create: {
          telegramUserId: tgId,
          deliveryDate: digest.metadata.deliveryDate,
          scheduledFor: new Date(),
          status: "failed",
          errorMessage: errMsg,
        },
      });

      throw err;
    }
  }

  /**
   * Scheduler tick: runs every minute across multi-instances safely using atomic PostgreSQL locks.
   */
  public async tick(botApi: any): Promise<void> {
    if (!botApi) return;

    try {
      const pool = getPool();
      // Fetch users who have daily digest enabled and are not paused
      const activeUsersQuery = `
        SELECT p.telegram_user_id, p.send_time, p.timezone, p.days, p.when_empty
        FROM user_daily_digest_preferences p
        JOIN users u ON u.telegram_user_id = p.telegram_user_id
        WHERE p.enabled = true
          AND (p.paused_until IS NULL OR p.paused_until < NOW())
          AND u.status = 'active';
      `;
      const res = await pool.query(activeUsersQuery);
      if (res.rows.length === 0) return;

      const now = new Date();

      for (const row of res.rows) {
        const tgId = BigInt(row.telegram_user_id);
        const tz = this.sanitizeTimezone(row.timezone);
        const sendTime = row.send_time || "08:00"; // "HH:mm"

        // Compute current local time in user's timezone
        const timeFormatter = new Intl.DateTimeFormat("en-GB", {
          timeZone: tz,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        const currentLocalTime = timeFormatter.format(now); // "HH:mm"

        // If local time does not match send time, skip
        if (currentLocalTime !== sendTime) continue;

        // Check active day of week
        const dayFormatter = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          weekday: "short",
        });
        const currentDay = dayFormatter.format(now).toLowerCase(); // "mon", "tue", ...
        let activeDays: string[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
        try {
          activeDays = typeof row.days === "string" ? JSON.parse(row.days) : row.days;
        } catch {}

        if (!activeDays.includes(currentDay)) continue;

        // Compute local date string for idempotency: "YYYY-MM-DD"
        const dateFormatter = new Intl.DateTimeFormat("en-CA", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const deliveryDate = dateFormatter.format(now);

        // Atomically acquire delivery lock via PostgreSQL UNIQUE constraint
        const claimQuery = `
          INSERT INTO daily_digest_deliveries (telegram_user_id, delivery_date, scheduled_for, status)
          VALUES ($1, $2, NOW(), 'in_progress')
          ON CONFLICT (telegram_user_id, delivery_date) DO NOTHING
          RETURNING id;
        `;
        const claimResult = await pool.query(claimQuery, [tgId.toString(), deliveryDate]);

        // If row was not inserted, another instance or past delivery already claimed it
        if (claimResult.rowCount === 0) continue;

        const deliveryId = claimResult.rows[0].id;

        // Execute delivery
        try {
          const digest = await this.buildDigest(tgId);
          if (digest.shouldSkip) {
            await pool.query(
              `UPDATE daily_digest_deliveries SET status = 'skipped_empty', updated_at = NOW() WHERE id = $1`,
              [deliveryId]
            );
            continue;
          }

          await botApi.sendMessage(Number(tgId), digest.htmlText, {
            parse_mode: "HTML",
            reply_markup: digest.keyboard,
          });

          await pool.query(
            `UPDATE daily_digest_deliveries 
             SET status = 'delivered', delivered_at = NOW(), sections_included = $2, item_count = $3, summary_text = $4, updated_at = NOW()
             WHERE id = $1`,
            [deliveryId, JSON.stringify(digest.sectionsIncluded), digest.itemCount, digest.htmlText.slice(0, 500)]
          );

          logger.info(
            { telegramUserId: tgId.toString(), deliveryDate, itemCount: digest.itemCount },
            "Scheduled daily digest successfully dispatched"
          );
        } catch (deliveryErr: any) {
          const errMsg = deliveryErr?.message || String(deliveryErr);
          const isBlocked = deliveryErr?.error_code === 403 || errMsg.includes("blocked by the user");

          if (isBlocked) {
            logger.warn({ telegramUserId: tgId.toString() }, "User blocked bot; disabling digest preference");
            await pool.query(
              `UPDATE user_daily_digest_preferences SET enabled = false WHERE telegram_user_id = $1`,
              [tgId.toString()]
            );
          }

          await pool.query(
            `UPDATE daily_digest_deliveries SET status = 'failed', error_message = $2, retry_count = retry_count + 1, updated_at = NOW() WHERE id = $1`,
            [deliveryId, errMsg]
          );

          logger.error(
            { telegramUserId: tgId.toString(), error: errMsg },
            "Failed scheduled daily digest delivery"
          );
        }
      }
    } catch (tickErr: any) {
      logger.warn({ error: tickErr?.message }, "Error during daily digest scheduler tick");
    }
  }
}

export const dailyDigestService = new DailyDigestService();

class DailyDigestScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  public start(bot: any): void {
    if (this.timer) return;
    logger.info("Starting Daily Digest Scheduler (1-minute tick interval)");
    this.timer = setInterval(async () => {
      if (this.isRunning) return;
      this.isRunning = true;
      try {
        await dailyDigestService.tick(bot?.api || bot);
      } catch (err) {
        logger.warn({ error: err }, "Error in daily digest scheduler tick");
      } finally {
        this.isRunning = false;
      }
    }, 60_000);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info("Daily Digest Scheduler stopped");
    }
  }
}

export const dailyDigestScheduler = new DailyDigestScheduler();
