import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { MODES, type ModeProfile } from "../config/mode";
import { PERSONALITIES, type PersonalityKey, type PersonalityProfile } from "../config/personality";

const TABLE = "assistant_behavior_registry";
export type BehaviorKind = "mode" | "personality";
export interface BehaviorRecord { kind: BehaviorKind; key: string; label: string; description: string; config: unknown; enabled: boolean; isDefault: boolean; updatedAt: string; }

class BehaviorRegistryService {
  private initialized = false;
  private defaults: Record<BehaviorKind, string | null> = { mode: "auto", personality: "playful" };

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ${sql.raw(TABLE)} (
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        label TEXT NOT NULL,
        description TEXT NOT NULL,
        config JSONB NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (kind, key)
      )
    `);
    await this.seedBuiltIns();
    await this.hydrateRuntime();
    this.initialized = true;
  }

  private async seedBuiltIns(): Promise<void> {
    for (const [key, profile] of Object.entries(PERSONALITIES)) {
      await db.execute(sql`
        INSERT INTO ${sql.raw(TABLE)} (kind,key,label,description,config,enabled,is_default)
        VALUES ('personality',${key},${profile.label},${profile.description},${JSON.stringify(profile)},TRUE,${key === "playful"})
        ON CONFLICT (kind,key) DO NOTHING
      `);
    }
    for (const [key, profile] of Object.entries(MODES) as Array<[string, ModeProfile]>) {
      if (!profile || !profile.id) continue;
      await db.execute(sql`
        INSERT INTO ${sql.raw(TABLE)} (kind,key,label,description,config,enabled,is_default)
        VALUES ('mode',${key},${profile.displayName},${profile.description},${JSON.stringify(profile)},TRUE,${key === "auto"})
        ON CONFLICT (kind,key) DO NOTHING
      `);
    }
  }

  async hydrateRuntime(): Promise<void> {
    const result = await db.execute(sql`SELECT kind,key,config,enabled,is_default FROM ${sql.raw(TABLE)} WHERE enabled = TRUE`);
    for (const row of result.rows as Array<Record<string, unknown>>) {
      const kind = String(row.kind);
      const key = String(row.key);
      const config = typeof row.config === "string" ? JSON.parse(row.config) : row.config;
      if (!config) continue;
      if (kind === "personality" && key in PERSONALITIES) PERSONALITIES[key as PersonalityKey] = config as PersonalityProfile;
      if (kind === "mode") (MODES as Record<string, ModeProfile>)[key] = config as ModeProfile;
      if ((kind === "personality" || kind === "mode") && Boolean(row.is_default)) this.defaults[kind] = key;
    }
  }

  getDefault(kind: BehaviorKind): string | null { return this.defaults[kind]; }

  async list(kind?: BehaviorKind): Promise<BehaviorRecord[]> {
    await this.initialize();
    const result = kind
      ? await db.execute(sql`SELECT kind,key,label,description,config,enabled,is_default,updated_at FROM ${sql.raw(TABLE)} WHERE kind=${kind} ORDER BY is_default DESC,label ASC`)
      : await db.execute(sql`SELECT kind,key,label,description,config,enabled,is_default,updated_at FROM ${sql.raw(TABLE)} ORDER BY kind,is_default DESC,label ASC`);
    return (result.rows as Array<Record<string, unknown>>).map((row) => ({ kind: String(row.kind) as BehaviorKind, key: String(row.key), label: String(row.label), description: String(row.description), config: row.config, enabled: Boolean(row.enabled), isDefault: Boolean(row.is_default), updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at) }));
  }

  async update(kind: BehaviorKind, key: string, patch: Record<string, unknown>): Promise<BehaviorRecord> {
    await this.initialize();
    const current = (await this.list(kind)).find((item) => item.key === key);
    if (!current) throw new Error(`Unknown ${kind}: ${key}`);
    const allowed = kind === "personality"
      ? ["label", "description", "instruction"]
      : ["displayName", "label", "description", "systemBehavior", "instruction", "preferredResponseStyle", "formattingProfile", "reasoningProfile", "researchPolicy", "codingPolicy", "tutoringPolicy"];
    const safePatch = Object.fromEntries(Object.entries(patch).filter(([name]) => allowed.includes(name)));
    const currentConfig = typeof current.config === "string" ? JSON.parse(current.config) : { ...(current.config as Record<string, unknown>) };
    const nextConfig = { ...(currentConfig as Record<string, unknown>), ...safePatch };
    const label = String(safePatch.label ?? safePatch.displayName ?? current.label);
    const description = String(safePatch.description ?? current.description);
    await db.execute(sql`UPDATE ${sql.raw(TABLE)} SET label=${label}, description=${description}, config=${JSON.stringify(nextConfig)}, updated_at=NOW() WHERE kind=${kind} AND key=${key}`);
    await this.hydrateRuntime();
    const updated = (await this.list(kind)).find((item) => item.key === key);
    if (!updated) throw new Error("Behavior update could not be verified");
    logger.info({ kind, key }, "Behavior registry updated and runtime hydrated");
    return updated;
  }

  async setDefault(kind: BehaviorKind, key: string): Promise<void> {
    await this.initialize();
    const exists = (await this.list(kind)).some((item) => item.key === key);
    if (!exists) throw new Error(`Unknown ${kind}: ${key}`);
    await db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE ${sql.raw(TABLE)} SET is_default=FALSE, updated_at=NOW() WHERE kind=${kind}`);
      await tx.execute(sql`UPDATE ${sql.raw(TABLE)} SET is_default=TRUE, updated_at=NOW() WHERE kind=${kind} AND key=${key}`);
    });
    this.defaults[kind] = key;
    await this.hydrateRuntime();
  }
}

export const behaviorRegistryService = new BehaviorRegistryService();
