import { getPool } from "@workspace/db";
import { logger } from "../lib/logger";

export type OnboardingStep = "welcome" | "personality" | "mode" | "proactivity" | "memory" | "about_you" | "timezone" | "ready";
export type ProactivityPreference = "never" | "occasional" | "proactive";

export interface OnboardingState {
  telegramUserId: number;
  chatId: number;
  status: "in_progress" | "completed";
  step: OnboardingStep;
  proactivityPreference: ProactivityPreference;
  memoryEnabled: boolean;
  timezone: string;
  updatedAt: string;
  completedAt?: string | null;
}

const TABLE = "onboarding_profiles";

function normalizeStep(value: unknown): OnboardingStep {
  const steps: OnboardingStep[] = ["welcome", "personality", "mode", "proactivity", "memory", "about_you", "timezone", "ready"];
  return typeof value === "string" && steps.includes(value as OnboardingStep) ? value as OnboardingStep : "welcome";
}

function normalizeProactivity(value: unknown): ProactivityPreference {
  return value === "never" || value === "proactive" ? value : "occasional";
}

export class OnboardingService {
  async initialize(): Promise<void> {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        telegram_user_id BIGINT PRIMARY KEY,
        chat_id BIGINT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('in_progress','completed')),
        step TEXT NOT NULL,
        proactivity_preference TEXT NOT NULL DEFAULT 'occasional',
        memory_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        timezone TEXT NOT NULL DEFAULT 'Africa/Lagos',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS onboarding_profiles_status_idx ON ${TABLE}(status);
    `);
  }

  async get(telegramUserId: number): Promise<OnboardingState | null> {
    const result = await getPool().query(`
      SELECT telegram_user_id AS "telegramUserId", chat_id AS "chatId", status, step,
             proactivity_preference AS "proactivityPreference", memory_enabled AS "memoryEnabled",
             timezone, updated_at AS "updatedAt", completed_at AS "completedAt"
      FROM ${TABLE} WHERE telegram_user_id = $1 LIMIT 1
    `, [telegramUserId]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      telegramUserId: Number(row.telegramUserId),
      chatId: Number(row.chatId),
      status: row.status === "completed" ? "completed" : "in_progress",
      step: normalizeStep(row.step),
      proactivityPreference: normalizeProactivity(row.proactivityPreference),
      memoryEnabled: row.memoryEnabled !== false,
      timezone: typeof row.timezone === "string" && row.timezone ? row.timezone : "Africa/Lagos",
      updatedAt: new Date(row.updatedAt).toISOString(),
      completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    };
  }

  async start(telegramUserId: number, chatId: number): Promise<OnboardingState> {
    const existing = await this.get(telegramUserId);
    if (existing?.status === "completed") return existing;
    return this.save(telegramUserId, chatId, { status: "in_progress", step: existing?.step ?? "welcome" });
  }

  async save(
    telegramUserId: number,
    chatId: number,
    patch: Partial<Pick<OnboardingState, "status" | "step" | "proactivityPreference" | "memoryEnabled" | "timezone">>,
  ): Promise<OnboardingState> {
    const current = await this.get(telegramUserId);
    const status = patch.status ?? current?.status ?? "in_progress";
    const step = normalizeStep(patch.step ?? current?.step ?? "welcome");
    const preference = normalizeProactivity(patch.proactivityPreference ?? current?.proactivityPreference);
    const memoryEnabled = patch.memoryEnabled ?? current?.memoryEnabled ?? true;
    const timezone = patch.timezone?.trim() || current?.timezone || "Africa/Lagos";
    await getPool().query(`
      INSERT INTO ${TABLE}(telegram_user_id, chat_id, status, step, proactivity_preference, memory_enabled, timezone, updated_at, completed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),CASE WHEN $3 = 'completed' THEN NOW() ELSE NULL END)
      ON CONFLICT (telegram_user_id) DO UPDATE SET
        chat_id=EXCLUDED.chat_id,
        status=EXCLUDED.status,
        step=EXCLUDED.step,
        proactivity_preference=EXCLUDED.proactivity_preference,
        memory_enabled=EXCLUDED.memory_enabled,
        timezone=EXCLUDED.timezone,
        updated_at=NOW(),
        completed_at=CASE WHEN EXCLUDED.status='completed' THEN NOW() ELSE ${TABLE}.completed_at END
    `, [telegramUserId, chatId, status, step, preference, memoryEnabled, timezone]);
    const saved = await this.get(telegramUserId);
    if (!saved) throw new Error("Onboarding state could not be persisted.");
    return saved;
  }

  async isCompleted(telegramUserId: number): Promise<boolean> {
    return (await this.get(telegramUserId))?.status === "completed";
  }

  async memoryEnabled(telegramUserId: number): Promise<boolean> {
    const state = await this.get(telegramUserId);
    return state?.status === "completed" ? state.memoryEnabled : true;
  }
}

export const onboardingService = new OnboardingService();
