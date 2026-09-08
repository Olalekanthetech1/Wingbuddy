import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { MODES, type ModeProfile } from "../config/mode";
import { PERSONALITIES, type PersonalityKey, type PersonalityProfile } from "../config/personality";
import { logger } from "../lib/logger";

const TABLE = "assistant_behavior_configs";
export type BehaviorKind = "mode" | "personality";

type RegistryRow = {
  kind: BehaviorKind;
  key: string;
  config: unknown;
  isDefault: boolean;
  version: number;
  updatedAt: string;
};

const PERSONALITY_KEYS = new Set(Object.keys(PERSONALITIES));
const MODE_KEYS = new Set(Object.keys(MODES));

class RuntimeBehaviorConfigService {
  private initialized = false;
  private defaults: Record<BehaviorKind, string> = { personality: "playful", mode: "auto" };

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ${sql.raw(TABLE)} (
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        config JSONB NOT NULL,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (kind, key),
        CONSTRAINT assistant_behavior_kind_check CHECK (kind IN ('mode', 'personality'))
      )
    `);
    await this.seedBuiltIns();
    await this.hydrateRuntime();
    this.initialized = true;
  }

  private async seedBuiltIns(): Promise<void> {
    for (const [key, profile] of Object.entries(PERSONALITIES)) {
      await db.execute(sql`
        INSERT INTO ${sql.raw(TABLE)} (kind, key, config, is_default)
        VALUES ('personality', ${key}, ${JSON.stringify(profile)}, ${key === "playful"})
        ON CONFLICT (kind, key) DO NOTHING
      `);
    }
    for (const [key, profile] of Object.entries(MODES)) {
      if (!profile || typeof profile !== "object") continue;
      await db.execute(sql`
        INSERT INTO ${sql.raw(TABLE)} (kind, key, config, is_default)
        VALUES ('mode', ${key}, ${JSON.stringify(profile)}, ${key === "auto"})
        ON CONFLICT (kind, key) DO NOTHING
      `);
    }
  }

  private valid(kind: BehaviorKind, key: string): boolean {
    return kind === "personality" ? PERSONALITY_KEYS.has(key) : MODE_KEYS.has(key);
  }

  private sanitize(kind: BehaviorKind, input: Record<string, unknown>, current: Record<string, unknown>): Record<string, unknown> {
    const common = ["label", "description"];
    const personality = [...common, "instruction"];
    const mode = [...common, "id", "key", "displayName", "instruction", "systemBehavior", "preferredResponseStyle", "formattingProfile", "capabilitiesList", "capabilities", "preferredTools", "toolRestrictions", "reasoningProfile", "researchPolicy", "codingPolicy", "tutoringPolicy"];
    const allowed = new Set(kind === "personality" ? personality : mode);
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(input)) if (allowed.has(key)) next[key] = value;
    return next;
  }

  async hydrateRuntime(): Promise<void> {
    const result = await db.execute(sql`SELECT kind, key, config, is_default FROM ${sql.raw(TABLE)}`);
    for (const row of result.rows as Array<Record<string, unknown>>) {
      const kind = String(row.kind) as BehaviorKind;
      const key = String(row.key);
      const config = typeof row.config === "string" ? JSON.parse(row.config) : row.config;
      if (!config || !this.valid(kind, key)) continue;
      if (kind === "personality") PERSONALITIES[key as PersonalityKey] = config as PersonalityProfile;
      else (MODES as Record<string, ModeProfile>)[key] = config as ModeProfile;
      if (Boolean(row.is_default)) this.defaults[kind] = key;
    }
  }

  getDefault(kind: BehaviorKind): string { return this.defaults[kind]; }

  async list(kind: BehaviorKind): Promise<RegistryRow[]> {
    await this.initialize();
    const result = await db.execute(sql`
      SELECT kind, key, config, is_default, version, updated_at
      FROM ${sql.raw(TABLE)}
      WHERE kind = ${kind}
      ORDER BY is_default DESC, key ASC
    `);
    return (result.rows as Array<Record<string, unknown>>).map((row) => ({
      kind: String(row.kind) as BehaviorKind,
      key: String(row.key),
      config: row.config,
      isDefault: Boolean(row.is_default),
      version: Number(row.version),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    }));
  }

  async update(kind: BehaviorKind, key: string, patch: Record<string, unknown>): Promise<RegistryRow> {
    await this.initialize();
    if (!this.valid(kind, key)) throw new Error(`Unsupported ${kind}: ${key}`);
    const rows = await this.list(kind);
    const current = rows.find((item) => item.key === key);
    if (!current) throw new Error(`Behavior profile not found: ${kind}/${key}`);
    const currentConfig = (typeof current.config === "string" ? JSON.parse(current.config) : current.config) as Record<string, unknown>;
    const next = this.sanitize(kind, patch, currentConfig);
    await db.execute(sql`
      UPDATE ${sql.raw(TABLE)}
      SET config = ${JSON.stringify(next)},
          version = version + 1,
          updated_at = NOW()
      WHERE kind = ${kind} AND key = ${key}
    `);
    await this.hydrateRuntime();
    const verified = (await this.list(kind)).find((item) => item.key === key);
    if (!verified) throw new Error("Behavior configuration verification failed");
    logger.info({ kind, key, version: verified.version }, "RUNTIME_BEHAVIOR_CONFIG_UPDATED");
    return verified;
  }

  async setDefault(kind: BehaviorKind, key: string): Promise<RegistryRow> {
    await this.initialize();
    if (!this.valid(kind, key)) throw new Error(`Unsupported ${kind}: ${key}`);
    await db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE ${sql.raw(TABLE)} SET is_default = FALSE, updated_at = NOW() WHERE kind = ${kind}`);
      await tx.execute(sql`UPDATE ${sql.raw(TABLE)} SET is_default = TRUE, updated_at = NOW(), version = version + 1 WHERE kind = ${kind} AND key = ${key}`);
    });
    this.defaults[kind] = key;
    await this.hydrateRuntime();
    const updated = (await this.list(kind)).find((item) => item.key === key);
    if (!updated) throw new Error("Default behavior verification failed");
    return updated;
  }
}

export const runtimeBehaviorConfigService = new RuntimeBehaviorConfigService();
