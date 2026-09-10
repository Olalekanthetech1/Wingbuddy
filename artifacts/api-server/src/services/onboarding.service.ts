import { getPool } from "@workspace/db";

export type OnboardingStep = "welcome" | "migration" | "personality" | "mode" | "proactivity" | "memory" | "about_you" | "timezone" | "ready";
export type ProactivityPreference = "never" | "occasional" | "proactive";
export const CURRENT_ONBOARDING_VERSION = 2;

export interface OnboardingState {
  telegramUserId: number;
  chatId: number;
  status: "in_progress" | "completed";
  step: OnboardingStep;
  proactivityPreference: ProactivityPreference;
  memoryEnabled: boolean;
  timezone: string;
  version: number;
  activeMessageId: number | null;
  updatedAt: string;
  completedAt?: string | null;
}

const TABLE = "onboarding_profiles";

function normalizeStep(value: unknown): OnboardingStep {
  const steps: OnboardingStep[] = ["welcome", "migration", "personality", "mode", "proactivity", "memory", "about_you", "timezone", "ready"];
  return typeof value === "string" && steps.includes(value as OnboardingStep) ? value as OnboardingStep : "welcome";
}

function normalizeProactivity(value: unknown): ProactivityPreference {
  return value === "never" || value === "proactive" ? value : "occasional";
}

function normalizeVersion(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function normalizeMessageId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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
        version INTEGER NOT NULL DEFAULT 0,
        active_message_id BIGINT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS active_message_id BIGINT;
      CREATE INDEX IF NOT EXISTS onboarding_profiles_status_idx ON ${TABLE}(status);
      CREATE INDEX IF NOT EXISTS onboarding_profiles_version_idx ON ${TABLE}(version);
    `);
  }

  async get(telegramUserId: number): Promise<OnboardingState | null> {
    const result = await getPool().query(`
      SELECT telegram_user_id AS "telegramUserId", chat_id AS "chatId", status, step,
             proactivity_preference AS "proactivityPreference", memory_enabled AS "memoryEnabled",
             timezone, version, active_message_id AS "activeMessageId", updated_at AS "updatedAt", completed_at AS "completedAt"
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
      version: normalizeVersion(row.version),
      activeMessageId: normalizeMessageId(row.activeMessageId),
      updatedAt: new Date(row.updatedAt).toISOString(),
      completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    };
  }

  async start(telegramUserId: number, chatId: number): Promise<OnboardingState> {
    const existing = await this.get(telegramUserId);
    if (existing?.status === "completed" && existing.version >= CURRENT_ONBOARDING_VERSION) return existing;
    return this.save(telegramUserId, chatId, {
      status: "in_progress",
      step: existing?.step ?? "welcome",
      version: CURRENT_ONBOARDING_VERSION,
    });
  }

  async startLegacyMigration(telegramUserId: number, chatId: number): Promise<OnboardingState> {
    const existing = await this.get(telegramUserId);
    return this.save(telegramUserId, chatId, {
      status: "in_progress",
      step: "migration",
      version: CURRENT_ONBOARDING_VERSION,
      proactivityPreference: existing?.proactivityPreference ?? "occasional",
      memoryEnabled: existing?.memoryEnabled ?? true,
      timezone: existing?.timezone ?? "Africa/Lagos",
    });
  }

  async completeLegacyMigration(telegramUserId: number, chatId: number): Promise<OnboardingState> {
    const existing = await this.get(telegramUserId);
    return this.save(telegramUserId, chatId, {
      status: "completed",
      step: "ready",
      version: CURRENT_ONBOARDING_VERSION,
      activeMessageId: null,
      proactivityPreference: existing?.proactivityPreference ?? "occasional",
      memoryEnabled: existing?.memoryEnabled ?? true,
      timezone: existing?.timezone ?? "Africa/Lagos",
    });
  }

  async save(
    telegramUserId: number,
    chatId: number,
    patch: Partial<Pick<OnboardingState, "status" | "step" | "proactivityPreference" | "memoryEnabled" | "timezone" | "version" | "activeMessageId">>,
  ): Promise<OnboardingState> {
    const current = await this.get(telegramUserId);
    const status = patch.status ?? current?.status ?? "in_progress";
    const step = normalizeStep(patch.step ?? current?.step ?? "welcome");
    const preference = normalizeProactivity(patch.proactivityPreference ?? current?.proactivityPreference);
    const memoryEnabled = patch.memoryEnabled ?? current?.memoryEnabled ?? true;
    const timezone = patch.timezone?.trim() || current?.timezone || "Africa/Lagos";
    const version = normalizeVersion(patch.version ?? current?.version ?? CURRENT_ONBOARDING_VERSION);
    const activeMessageId = patch.activeMessageId !== undefined ? normalizeMessageId(patch.activeMessageId) : current?.activeMessageId ?? null;

    await getPool().query(`
      INSERT INTO ${TABLE}(telegram_user_id, chat_id, status, step, proactivity_preference, memory_enabled, timezone, version, active_message_id, updated_at, completed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),CASE WHEN $3 = 'completed' THEN NOW() ELSE NULL END)
      ON CONFLICT (telegram_user_id) DO UPDATE SET
        chat_id=EXCLUDED.chat_id,
        status=EXCLUDED.status,
        step=EXCLUDED.step,
        proactivity_preference=EXCLUDED.proactivity_preference,
        memory_enabled=EXCLUDED.memory_enabled,
        timezone=EXCLUDED.timezone,
        version=EXCLUDED.version,
        active_message_id=EXCLUDED.active_message_id,
        updated_at=NOW(),
        completed_at=CASE WHEN EXCLUDED.status='completed' THEN NOW() ELSE ${TABLE}.completed_at END
    `, [telegramUserId, chatId, status, step, preference, memoryEnabled, timezone, version, activeMessageId]);

    const saved = await this.get(telegramUserId);
    if (!saved) throw new Error("Onboarding state could not be persisted.");
    return saved;
  }

  async setActiveMessage(telegramUserId: number, chatId: number, messageId: number | null): Promise<OnboardingState> {
    return this.save(telegramUserId, chatId, { activeMessageId: messageId });
  }

  async isCompleted(telegramUserId: number): Promise<boolean> {
    const state = await this.get(telegramUserId);
    return state?.status === "completed" && state.version >= CURRENT_ONBOARDING_VERSION;
  }

  async memoryEnabled(telegramUserId: number): Promise<boolean> {
    const state = await this.get(telegramUserId);
    return state?.status === "completed" ? state.memoryEnabled : true;
  }
}

export const onboardingService = new OnboardingService();
