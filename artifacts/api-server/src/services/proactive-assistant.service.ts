import { eq } from "drizzle-orm";
import { db, systemSettingsTable } from "@workspace/db";
import { getPool } from "@workspace/db";
import { adaptiveAIRouterService } from "./adaptive-ai-router.service";
import type { AIChatRequest } from "./ai-provider.types";
import { logger } from "../lib/logger";
import type { Bot } from "grammy";
import { timezoneService } from "./timezone.service";

export type ProactivePeriod = "morning" | "evening";

export interface ProactiveAssistantConfig {
  enabled: boolean;
  morningEnabled: boolean;
  morningTime: string;
  eveningEnabled: boolean;
  eveningTime: string;
  timezone: string;
  dailyMessageLimit: number;
  quietHoursStart: string;
  quietHoursEnd: string;
  maxMessageChars: number;
  generationMode: "adaptive_ai";
  updatedAt: string;
}

interface ProactiveTarget {
  telegramUserId: number;
  chatId: number;
  firstName: string;
  personality: string;
  mode: string;
  userTimezone?: string | null;
  conversationSummary?: string | null;
  activeTasks: number;
  activeReminders: number;
  activeTaskTitles?: string[];
  recentExchanges?: string[];
  userMemories?: string[];
}

const CONFIG_KEY = "PROACTIVE_ASSISTANT_CONFIG";
const DELIVERY_TABLE = "proactive_message_deliveries";
const DEFAULT_CONFIG: ProactiveAssistantConfig = {
  enabled: false,
  morningEnabled: true,
  morningTime: "07:00",
  eveningEnabled: true,
  eveningTime: "20:00",
  timezone: "UTC",
  dailyMessageLimit: 2,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  maxMessageChars: 900,
  generationMode: "adaptive_ai",
  updatedAt: new Date().toISOString(),
};

function validTime(value: unknown, fallback: string): string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

function finiteInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function isValidTimezone(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_CONFIG.timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return DEFAULT_CONFIG.timezone;
  }
}

function normalize(raw: Partial<ProactiveAssistantConfig> | undefined): ProactiveAssistantConfig {
  const current = raw || {};
  return {
    enabled: current.enabled === true,
    morningEnabled: current.morningEnabled !== false,
    morningTime: validTime(current.morningTime, DEFAULT_CONFIG.morningTime),
    eveningEnabled: current.eveningEnabled !== false,
    eveningTime: validTime(current.eveningTime, DEFAULT_CONFIG.eveningTime),
    timezone: isValidTimezone(current.timezone),
    dailyMessageLimit: finiteInt(current.dailyMessageLimit, DEFAULT_CONFIG.dailyMessageLimit, 1, 6),
    quietHoursStart: validTime(current.quietHoursStart, DEFAULT_CONFIG.quietHoursStart),
    quietHoursEnd: validTime(current.quietHoursEnd, DEFAULT_CONFIG.quietHoursEnd),
    maxMessageChars: finiteInt(current.maxMessageChars, DEFAULT_CONFIG.maxMessageChars, 200, 4000),
    generationMode: "adaptive_ai",
    updatedAt: typeof current.updatedAt === "string" ? current.updatedAt : new Date().toISOString(),
  };
}

function minuteOfDay(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function localParts(date: Date, timezone: string): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function minuteWithinRange(current: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function inQuietHours(currentMinuteOfDay: number, config: ProactiveAssistantConfig): boolean {
  return minuteWithinRange(currentMinuteOfDay, minuteOfDay(config.quietHoursStart), minuteOfDay(config.quietHoursEnd));
}

export class ProactiveAssistantService {
  private bot: Bot | null = null;
  private timer?: NodeJS.Timeout;
  private tickRunning = false;
  private lastTickKey = "";

  async initialize(): Promise<void> {
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${DELIVERY_TABLE} (
        id BIGSERIAL PRIMARY KEY,
        telegram_user_id BIGINT NOT NULL,
        chat_id BIGINT NOT NULL,
        local_date DATE NOT NULL,
        period TEXT NOT NULL,
        message TEXT NOT NULL,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (telegram_user_id, local_date, period)
      );
      CREATE INDEX IF NOT EXISTS proactive_message_deliveries_user_day_idx
        ON ${DELIVERY_TABLE}(telegram_user_id, local_date);
      CREATE INDEX IF NOT EXISTS proactive_message_deliveries_sent_at_idx
        ON ${DELIVERY_TABLE}(sent_at);
    `);
    await this.getConfig();
  }

  async getConfig(): Promise<ProactiveAssistantConfig> {
    try {
      const rows = await db.select({ value: systemSettingsTable.value }).from(systemSettingsTable).where(eq(systemSettingsTable.key, CONFIG_KEY)).limit(1);
      if (rows[0]?.value) return normalize(JSON.parse(rows[0].value));
    } catch (error) {
      logger.warn({ error: String(error) }, "Failed to read proactive assistant configuration");
    }
    return normalize(DEFAULT_CONFIG);
  }

  async updateConfig(patch: Partial<ProactiveAssistantConfig>): Promise<ProactiveAssistantConfig> {
    const next = normalize({ ...(await this.getConfig()), ...patch, updatedAt: new Date().toISOString() });
    await db.insert(systemSettingsTable).values({ key: CONFIG_KEY, value: JSON.stringify(next), updatedAt: new Date() }).onConflictDoUpdate({
      target: systemSettingsTable.key,
      set: { value: JSON.stringify(next), updatedAt: new Date() },
    });
    return next;
  }

  attachBot(bot: Bot): void {
    this.bot = bot;
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), 30_000);
      logger.info("Started Proactive Assistant scheduler (30s interval)");
    }
  }

  detachBot(bot?: Bot): void {
    if (bot && this.bot !== bot) return;
    this.bot = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async getStatus(): Promise<Record<string, unknown>> {
    const config = await this.getConfig();
    const local = localParts(new Date(), config.timezone);
    const today = local.date;
    try {
      const result = await getPool().query(
        `SELECT COUNT(*)::int AS count FROM ${DELIVERY_TABLE} WHERE local_date = $1::date`,
        [today],
      );
      return {
        config,
        schedulerActive: Boolean(this.timer && this.bot),
        timezoneNow: { date: today, hour: local.hour, minute: local.minute },
        sentToday: Number(result.rows[0]?.count || 0),
      };
    } catch {
      return {
        config,
        schedulerActive: Boolean(this.timer && this.bot),
        timezoneNow: { date: today, hour: local.hour, minute: local.minute },
        sentToday: 0,
      };
    }
  }

  async preview(telegramUserId: number, period: ProactivePeriod): Promise<{ message: string; target: ProactiveTarget }> {
    const target = await this.resolveTarget(telegramUserId);
    if (!target) throw new Error("No active Telegram conversation found for that user");
    return { message: await this.generateMessage(target, period), target };
  }

  async sendTest(telegramUserId: number, period: ProactivePeriod): Promise<{ message: string; chatId: number }> {
    if (!this.bot) throw new Error("Telegram runtime is not active");
    const { message, target } = await this.preview(telegramUserId, period);
    await this.bot.api.sendMessage(target.chatId, message);
    return { message, chatId: target.chatId };
  }

  private async tick(): Promise<void> {
    if (!this.bot || this.tickRunning) return;
    this.tickRunning = true;
    try {
      const config = await this.getConfig();
      if (!config.enabled) return;
      const targets = await this.listTargets();
      const now = new Date();

      for (const target of targets) {
        try {
          const userTz = await timezoneService.getUserTimezone(target.telegramUserId);
          const userLocal = timezoneService.getLocalParts(now, userTz);
          const currentMinute = userLocal.hour * 60 + userLocal.minute;

          if (inQuietHours(currentMinute, config)) continue;

          const period: ProactivePeriod | null = config.morningEnabled && currentMinute === minuteOfDay(config.morningTime)
            ? "morning"
            : config.eveningEnabled && currentMinute === minuteOfDay(config.eveningTime)
              ? "evening"
              : null;
          if (!period) continue;

          if (!(await this.claimDelivery(target.telegramUserId, target.chatId, userLocal.date, period, config.dailyMessageLimit))) continue;
          const message = await this.generateMessage(target, period);
          await this.bot.api.sendMessage(target.chatId, message);
          await getPool().query(
            `UPDATE ${DELIVERY_TABLE} SET message = $1 WHERE telegram_user_id = $2 AND local_date = $3::date AND period = $4`,
            [message, target.telegramUserId, userLocal.date, period]
          );
        } catch (error) {
          logger.warn({ telegramUserId: target.telegramUserId, error: error instanceof Error ? error.message : String(error) }, "Proactive check-in delivery failed");
        }
      }
    } finally {
      this.tickRunning = false;
    }
  }

  private async listTargets(): Promise<ProactiveTarget[]> {
    const rows = await getPool().query(`
      SELECT DISTINCT ON (u.telegram_user_id)
        u.telegram_user_id AS "telegramUserId",
        c.chat_id AS "chatId",
        COALESCE(u.first_name, u.username, 'there') AS "firstName",
        COALESCE(u.personality, 'playful') AS personality,
        COALESCE(u.mode, 'general') AS mode,
        c.summary AS "conversationSummary",
        COALESCE((SELECT ut.timezone FROM user_timezones ut WHERE ut.telegram_user_id = u.telegram_user_id LIMIT 1), (SELECT op.timezone FROM onboarding_profiles op WHERE op.telegram_user_id = u.telegram_user_id LIMIT 1), 'UTC') AS "userTimezone",
        (SELECT COUNT(*) FROM agent_tasks t WHERE t.telegram_user_id = u.telegram_user_id AND t.status IN ('pending','active','paused','waiting'))::int AS "activeTasks",
        (SELECT COUNT(*) FROM reminders r WHERE r.telegram_user_id = u.telegram_user_id AND r.is_completed = FALSE)::int AS "activeReminders",
        (SELECT json_agg(t.title) FROM (SELECT title FROM agent_tasks WHERE telegram_user_id = u.telegram_user_id AND status IN ('pending','active','paused','waiting') ORDER BY updated_at DESC LIMIT 3) t) AS "activeTaskTitles",
        (SELECT json_agg(json_build_object('role', m.role, 'content', LEFT(m.content, 200))) FROM (SELECT role, content FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 5) m) AS "recentExchanges",
        (SELECT json_agg(json_build_object('key', mem.key, 'content', mem.content)) FROM (SELECT key, content FROM user_memories WHERE telegram_user_id = u.telegram_user_id AND status = 'active' ORDER BY updated_at DESC LIMIT 3) mem) AS "userMemories"
      FROM users u
      JOIN conversations c ON c.telegram_user_id = u.telegram_user_id
      WHERE c.is_active = TRUE
      ORDER BY u.telegram_user_id, c.updated_at DESC
    `);
    return rows.rows.map((row) => this.mapTargetRow(row));
  }

  private async resolveTarget(telegramUserId: number): Promise<ProactiveTarget | null> {
    const rows = await getPool().query(`
      SELECT
        u.telegram_user_id AS "telegramUserId",
        c.chat_id AS "chatId",
        COALESCE(u.first_name, u.username, 'there') AS "firstName",
        COALESCE(u.personality, 'playful') AS personality,
        COALESCE(u.mode, 'general') AS mode,
        c.summary AS "conversationSummary",
        COALESCE((SELECT ut.timezone FROM user_timezones ut WHERE ut.telegram_user_id = u.telegram_user_id LIMIT 1), (SELECT op.timezone FROM onboarding_profiles op WHERE op.telegram_user_id = u.telegram_user_id LIMIT 1), 'UTC') AS "userTimezone",
        (SELECT COUNT(*) FROM agent_tasks t WHERE t.telegram_user_id = u.telegram_user_id AND t.status IN ('pending','active','paused','waiting'))::int AS "activeTasks",
        (SELECT COUNT(*) FROM reminders r WHERE r.telegram_user_id = u.telegram_user_id AND r.is_completed = FALSE)::int AS "activeReminders",
        (SELECT json_agg(t.title) FROM (SELECT title FROM agent_tasks WHERE telegram_user_id = u.telegram_user_id AND status IN ('pending','active','paused','waiting') ORDER BY updated_at DESC LIMIT 3) t) AS "activeTaskTitles",
        (SELECT json_agg(json_build_object('role', m.role, 'content', LEFT(m.content, 200))) FROM (SELECT role, content FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 5) m) AS "recentExchanges",
        (SELECT json_agg(json_build_object('key', mem.key, 'content', mem.content)) FROM (SELECT key, content FROM user_memories WHERE telegram_user_id = u.telegram_user_id AND status = 'active' ORDER BY updated_at DESC LIMIT 3) mem) AS "userMemories"
      FROM users u
      JOIN conversations c ON c.telegram_user_id = u.telegram_user_id
      WHERE u.telegram_user_id = $1 AND c.is_active = TRUE
      ORDER BY c.updated_at DESC LIMIT 1
    `, [telegramUserId]);
    const row = rows.rows[0];
    if (!row) return null;
    return this.mapTargetRow(row);
  }

  private mapTargetRow(row: any): ProactiveTarget {
    const parseTitles = (val: unknown): string[] => {
      if (Array.isArray(val)) return val.filter(Boolean).map(String);
      return [];
    };
    const parseExchanges = (val: unknown): string[] => {
      if (Array.isArray(val)) {
        return val
          .filter((item) => item && typeof item === "object" && "role" in item)
          .map((item: any) => `${item.role === "user" ? "User" : "Assistant"}: ${String(item.content || "").trim().slice(0, 150)}`);
      }
      return [];
    };
    const parseMemories = (val: unknown): string[] => {
      if (Array.isArray(val)) {
        return val
          .filter((item) => item && typeof item === "object" && "content" in item)
          .map((item: any) => String(item.content || "").trim().slice(0, 150));
      }
      return [];
    };

    return {
      telegramUserId: Number(row.telegramUserId),
      chatId: Number(row.chatId),
      firstName: String(row.firstName || "there").trim(),
      personality: String(row.personality || "playful"),
      mode: String(row.mode || "general"),
      userTimezone: row.userTimezone ? String(row.userTimezone) : null,
      conversationSummary: row.conversationSummary ? String(row.conversationSummary) : null,
      activeTasks: Number(row.activeTasks || 0),
      activeReminders: Number(row.activeReminders || 0),
      activeTaskTitles: parseTitles(row.activeTaskTitles),
      recentExchanges: parseExchanges(row.recentExchanges),
      userMemories: parseMemories(row.userMemories),
    };
  }

  private async claimDelivery(telegramUserId: number, chatId: number, localDate: string, period: ProactivePeriod, dailyLimit: number): Promise<boolean> {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`proactive:${telegramUserId}:${localDate}`]);
      const count = await client.query(`SELECT COUNT(*)::int AS count FROM ${DELIVERY_TABLE} WHERE telegram_user_id = $1 AND local_date = $2::date`, [telegramUserId, localDate]);
      if (Number(count.rows[0]?.count || 0) >= dailyLimit) {
        await client.query("ROLLBACK");
        return false;
      }
      const inserted = await client.query(`INSERT INTO ${DELIVERY_TABLE}(telegram_user_id, chat_id, local_date, period, message) VALUES($1,$2,$3::date,$4,'pending') ON CONFLICT (telegram_user_id, local_date, period) DO NOTHING RETURNING id`, [telegramUserId, chatId, localDate, period]);
      await client.query(inserted.rows.length ? "COMMIT" : "ROLLBACK");
      return inserted.rows.length > 0;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  private async generateMessage(target: ProactiveTarget, period: ProactivePeriod): Promise<string> {
    const config = await this.getConfig();
    const timeOfDay = period === "morning" ? "morning" : "evening";

    const contextBlocks: string[] = [
      `User Name: ${target.firstName}`,
      `Preferred Persona/Vibe: ${target.personality}`,
      `Current Assistant Mode: ${target.mode}`,
    ];

    if (target.activeTasks > 0) {
      const titles = (target.activeTaskTitles && target.activeTaskTitles.length > 0)
        ? ` (including: ${target.activeTaskTitles.join(", ")})`
        : "";
      contextBlocks.push(`Active Tasks: ${target.activeTasks}${titles}`);
    } else {
      contextBlocks.push("Active Tasks: 0");
    }

    if (target.activeReminders > 0) {
      contextBlocks.push(`Active Reminders: ${target.activeReminders}`);
    }

    if (target.userMemories && target.userMemories.length > 0) {
      contextBlocks.push(`Key User Context & Preferences:\n- ${target.userMemories.join("\n- ")}`);
    }

    if (target.conversationSummary) {
      contextBlocks.push(`Recent Conversation Summary: ${String(target.conversationSummary).slice(0, 800)}`);
    } else if (target.recentExchanges && target.recentExchanges.length > 0) {
      contextBlocks.push(`Recent Chat Messages:\n${target.recentExchanges.slice(0, 4).join("\n")}`);
    } else {
      contextBlocks.push("Recent Activity: No recent conversation recorded yet.");
    }

    const context = contextBlocks.join("\n\n");

    const systemPrompt = [
      "You are a personalized, perceptive AI assistant generating a proactive daily check-in message on Telegram.",
      "CRITICAL MESSAGE STRUCTURE REQUIREMENTS:",
      "1. Warm, natural greeting addressing the user by their first name.",
      "2. Contextual remark or observation reflecting their persona, their recent discussion, or their active tasks/goals.",
      "3. An engaging, low-friction check-in question or actionable suggestion to kick off the day or wind down smoothly.",
      "",
      "STRICT RULES:",
      "- NEVER output a single-line or isolated greeting (e.g. NEVER just 'Good morning, [Name]'. It must always be a complete, engaging 2-4 sentence check-in).",
      "- Do NOT invent false facts or assume events that are not in the context.",
      "- Do NOT mention being an AI, a bot, or an automated campaign.",
      "- Maintain the user's preferred personality tone (playful, balanced, creative, etc.).",
      "- Keep formatting clean, natural, and Telegram-friendly without markdown tables.",
      `- Keep length strictly within ${config.maxMessageChars} characters.`,
    ].join("\n");

    const userPrompt = [
      `Generate the ${timeOfDay} check-in for ${target.firstName}.`,
      "Ensure it consists of 2 to 4 complete, conversational sentences with a friendly opening, genuine context reference, and a helpful check-in question.",
      `Context:\n${context}`,
    ].join("\n\n");

    const request: AIChatRequest = {
      model: "",
      temperature: 0.75,
      maxOutputTokens: 450,
      thinkingBudget: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    };

    const result = await adaptiveAIRouterService.route(request, {});
    let text = result.response.text.trim();

    // Substance Guard: Verify that output is not clipped or a bare greeting
    const isTruncated = text.length < 60 || (!text.includes("?") && !text.includes("—") && text.split("\n").length <= 1 && text.split(" ").length < 12);

    if (isTruncated) {
      logger.info({ userId: target.telegramUserId, initialLen: text.length }, "Proactive check-in was too brief; triggering dynamic AI expansion pass");
      const refinementRequest: AIChatRequest = {
        model: "",
        temperature: 0.7,
        maxOutputTokens: 450,
        thinkingBudget: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
          { role: "assistant", content: text },
          { role: "user", content: "Expand that into a complete, lively 2-3 sentence check-in message. Include a contextual observation and an open-ended check-in question. Do not leave it as just a bare greeting." },
        ],
      };
      const refinedResult = await adaptiveAIRouterService.route(refinementRequest, {});
      const refinedText = refinedResult.response.text.trim();
      if (refinedText && refinedText.length >= 50) {
        text = refinedText;
      }
    }

    if (!text) throw new Error("Adaptive AI returned an empty proactive message");
    return text.slice(0, config.maxMessageChars).trim();
  }
}

export const proactiveAssistantService = new ProactiveAssistantService();
