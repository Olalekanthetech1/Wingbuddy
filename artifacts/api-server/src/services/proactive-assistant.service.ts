import { desc, eq } from "drizzle-orm";
import { db, systemSettingsTable, usersTable, conversationsTable } from "@workspace/db";
import { getPool } from "@workspace/db";
import { adaptiveAIRouterService } from "./adaptive-ai-router.service";
import type { AIChatRequest } from "./ai-provider.types";
import { logger } from "../lib/logger";
import type { Bot } from "grammy";

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
  conversationSummary?: string | null;
  activeTasks: number;
  activeReminders: number;
}

const CONFIG_KEY = "PROACTIVE_ASSISTANT_CONFIG";
const DELIVERY_TABLE = "proactive_message_deliveries";
const DEFAULT_CONFIG: ProactiveAssistantConfig = {
  enabled: false,
  morningEnabled: true,
  morningTime: "07:00",
  eveningEnabled: true,
  eveningTime: "20:00",
  timezone: "Africa/Lagos",
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

function inQuietHours(hour: number, config: ProactiveAssistantConfig): boolean {
  const current = hour * 60;
  const start = minuteOfDay(config.quietHoursStart);
  const end = minuteOfDay(config.quietHoursEnd);
  if (start === end) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
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
      return { config, schedulerActive: Boolean(this.timer && this.bot), timezoneNow: { date: today, hour: local.hour, minute: local.minute }, sentToday: Number(result.rows[0]?.count || 0) };
    } catch {
      return { config, schedulerActive: Boolean(this.timer && this.bot), timezoneNow: { date: today, hour: local.hour, minute: local.minute }, sentToday: 0 };
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
      const local = localParts(new Date(), config.timezone);
      const minuteKey = `${local.date}:${local.hour}:${local.minute}`;
      if (minuteKey === this.lastTickKey) return;
      this.lastTickKey = minuteKey;
      if (inQuietHours(local.hour * 1 + Math.floor(local.minute / 60), config)) return;
      const current = local.hour * 60 + local.minute;
      const period: ProactivePeriod | null = config.morningEnabled && current === minuteOfDay(config.morningTime)
        ? "morning"
        : config.eveningEnabled && current === minuteOfDay(config.eveningTime)
          ? "evening"
          : null;
      if (!period) return;
      const targets = await this.listTargets();
      for (const target of targets) {
        try {
          if (!(await this.claimDelivery(target.telegramUserId, target.chatId, local.date, period, config.dailyMessageLimit))) continue;
          const message = await this.generateMessage(target, period);
          await this.bot.api.sendMessage(target.chatId, message);
          await getPool().query(`UPDATE ${DELIVERY_TABLE} SET message = $1 WHERE telegram_user_id = $2 AND local_date = $3::date AND period = $4`, [message, target.telegramUserId, local.date, period]);
        } catch (error) {
          await getPool().query(`DELETE FROM ${DELIVERY_TABLE} WHERE telegram_user_id = $1 AND local_date = $2::date AND period = $3`, [target.telegramUserId, local.date, period]).catch(() => {});
          logger.warn({ telegramUserId: target.telegramUserId, period, error: error instanceof Error ? error.message : String(error) }, "Proactive check-in delivery failed");
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
        (SELECT COUNT(*) FROM agent_tasks t WHERE t.telegram_user_id = u.telegram_user_id AND t.status IN ('pending','active','paused','waiting'))::int AS "activeTasks",
        (SELECT COUNT(*) FROM reminders r WHERE r.telegram_user_id = u.telegram_user_id AND r.is_completed = FALSE)::int AS "activeReminders"
      FROM users u
      JOIN conversations c ON c.telegram_user_id = u.telegram_user_id
      WHERE c.is_active = TRUE
      ORDER BY u.telegram_user_id, c.updated_at DESC
    `);
    return rows.rows.map((row) => ({ ...row, telegramUserId: Number(row.telegramUserId), chatId: Number(row.chatId), activeTasks: Number(row.activeTasks || 0), activeReminders: Number(row.activeReminders || 0) }));
  }

  private async resolveTarget(telegramUserId: number): Promise<ProactiveTarget | null> {
    const rows = await getPool().query(`
      SELECT u.telegram_user_id AS "telegramUserId", c.chat_id AS "chatId", COALESCE(u.first_name, u.username, 'there') AS "firstName",
        COALESCE(u.personality, 'playful') AS personality, COALESCE(u.mode, 'general') AS mode, c.summary AS "conversationSummary",
        (SELECT COUNT(*) FROM agent_tasks t WHERE t.telegram_user_id = u.telegram_user_id AND t.status IN ('pending','active','paused','waiting'))::int AS "activeTasks",
        (SELECT COUNT(*) FROM reminders r WHERE r.telegram_user_id = u.telegram_user_id AND r.is_completed = FALSE)::int AS "activeReminders"
      FROM users u JOIN conversations c ON c.telegram_user_id = u.telegram_user_id
      WHERE u.telegram_user_id = $1 AND c.is_active = TRUE
      ORDER BY c.updated_at DESC LIMIT 1
    `, [telegramUserId]);
    const row = rows.rows[0];
    if (!row) return null;
    return { ...row, telegramUserId: Number(row.telegramUserId), chatId: Number(row.chatId), activeTasks: Number(row.activeTasks || 0), activeReminders: Number(row.activeReminders || 0) };
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
    const greeting = period === "morning" ? "morning" : "evening";
    const context = [
      `Name: ${target.firstName}`,
      `Preferred personality: ${target.personality}`,
      `Current mode: ${target.mode}`,
      `Active tasks: ${target.activeTasks}`,
      `Active reminders: ${target.activeReminders}`,
      target.conversationSummary ? `Recent conversation summary: ${String(target.conversationSummary).slice(0, 1200)}` : "No recent conversation summary available.",
    ].join("\n");
    const request: AIChatRequest = {
      model: "",
      temperature: 0.8,
      maxOutputTokens: 220,
      messages: [
        { role: "system", content: "You are generating one proactive Telegram check-in for an AI assistant. Be warm, concise, natural and useful. Do not invent facts. Do not mention being an AI. Do not make the message sound like an automated campaign. Use the supplied context only. Do not use markdown tables. Keep it self-contained." },
        { role: "user", content: `Create a personalized ${greeting} check-in for ${target.firstName}. Mention relevant tasks or reminders only when useful; otherwise simply greet and invite a useful next action. Maximum ${config.maxMessageChars} characters. Context:\n${context}` },
      ],
    };
    const result = await adaptiveAIRouterService.route(request, {});
    const text = result.response.text.trim();
    if (!text) throw new Error("Adaptive AI returned an empty proactive message");
    return text.slice(0, config.maxMessageChars).trim();
  }
}

export const proactiveAssistantService = new ProactiveAssistantService();
