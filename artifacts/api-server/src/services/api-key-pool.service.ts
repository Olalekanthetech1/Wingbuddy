import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

export type KeyStatus = "healthy" | "cooldown" | "disabled" | "invalid";
export type RotationMode = "round_robin" | "failover";
export type KeySource = "env" | "dashboard";

export interface ManagedKey {
  id: string;
  name: string;
  key: string;
  status: KeyStatus;
  cooldownUntil?: number;
  lastError?: string;
  totalSuccess: number;
  totalErrors: number;
  lastUsedAt?: string;
  source: KeySource;
  createdAt: string;
  avgLatencyMs?: number;
}

export interface ManagedKeyPublicInfo {
  id: string;
  name: string;
  maskedKey: string;
  status: KeyStatus;
  cooldownSecondsLeft: number;
  lastError?: string;
  totalSuccess: number;
  totalErrors: number;
  lastUsedAt?: string;
  source: KeySource;
  createdAt: string;
  avgLatencyMs?: number;
}

export interface KeyPoolSummary {
  rotationMode: RotationMode;
  totalKeys: number;
  healthyKeys: number;
  inCooldownKeys: number;
  disabledKeys: number;
  invalidKeys: number;
  keys: ManagedKeyPublicInfo[];
}

type DbRow = Record<string, unknown>;

const TABLE = "ai_managed_api_keys";
const LEGACY_SETTING = "GEMINI_API_KEY";

function asText(value: unknown): string { return typeof value === "string" ? value : ""; }
function asNumber(value: unknown, fallback = 0): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function asDateIso(value: unknown): string { if (value instanceof Date) return value.toISOString(); const text = asText(value); return text ? new Date(text).toISOString() : new Date().toISOString(); }

export class ApiKeyPoolService {
  private keys: Map<string, ManagedKey> = new Map();
  private rotationMode: RotationMode = "round_robin";
  private currentIndex = 0;
  private readonly defaultCooldownMs = 45_000;
  private initialized = false;

  constructor(initialKeys?: Array<{ key: string; name?: string }>) { this.discoverInitialKeys(initialKeys); }

  private mask(key: string): string { if (!key || key.length < 8) return "••••••••"; return `${key.slice(0, 6)}...${key.slice(-4)}`; }

  private encryptionKey(): Buffer {
    const secret = process.env.API_KEY_ENCRYPTION_SECRET?.trim() || process.env.APP_ENCRYPTION_SECRET?.trim() || process.env.SESSION_SECRET?.trim() || "fallback-in-memory-managed-key-secret";
    return createHash("sha256").update(secret).digest();
  }

  private encryptSecret(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
  }

  private decryptSecret(payload: string): string {
    const [version, ivB64, tagB64, ciphertextB64] = payload.split(":");
    if (version !== "v1" || !ivB64 || !tagB64 || !ciphertextB64) throw new Error("Unsupported encrypted API key format");
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64url")), decipher.final()]).toString("utf8");
  }

  private fingerprint(key: string): string { return createHash("sha256").update(key).digest("hex"); }

  public async initializeDb(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ${sql.raw(TABLE)} (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'gemini',
        name TEXT NOT NULL,
        secret_ciphertext TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        status TEXT NOT NULL DEFAULT 'healthy',
        cooldown_until BIGINT,
        total_success INTEGER NOT NULL DEFAULT 0,
        total_errors INTEGER NOT NULL DEFAULT 0,
        avg_latency_ms INTEGER,
        last_error TEXT,
        last_used_at TIMESTAMPTZ,
        source TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_managed_api_keys_provider_idx ON ${sql.raw(TABLE)} (provider, enabled);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_managed_api_keys_deleted_idx ON ${sql.raw(TABLE)} (deleted_at);`);
    this.initialized = true;
  }

  private parseConfiguredEnvKeys(): Array<{ key: string; name: string }> {
    const results: Array<{ key: string; name: string }> = [];
    const push = (value: string | undefined, name: string): void => {
      if (!value) return;
      let count = 1;
      for (const key of value.split(/[,\s\n]+/).map((v) => v.trim()).filter(Boolean)) {
        if (key.length >= 10 && !results.some((item) => item.key === key)) {
          results.push({ key, name: `${name} ${count++}`.trim() });
        }
      }
    };
    push(process.env.GEMINI_API_KEY, "Primary environment key");
    push(process.env.GEMINI_API_KEYS, "Key");
    for (let index = 1; index <= 20; index += 1) push(process.env[`GEMINI_API_KEY_${index}`], `Environment key ${index}`);
    return results;
  }

  private discoverInitialKeys(passedKeys?: Array<{ key: string; name?: string }>): void {
    const discovered = new Set<string>();
    const add = (rawKey: string, name: string, source: KeySource): void => {
      const clean = rawKey.trim(); if (!clean || clean.length < 10 || discovered.has(clean)) return; discovered.add(clean);
      const id = `key-${randomUUID()}`;
      this.keys.set(id, { id, name, key: clean, status: "healthy", totalSuccess: 0, totalErrors: 0, source, createdAt: new Date().toISOString() });
    };
    for (const item of this.parseConfiguredEnvKeys()) add(item.key, item.name, "env");
    for (const item of passedKeys || []) add(item.key, item.name || "Dashboard key", "dashboard");
    const envMode = process.env.KEY_ROTATION_MODE; if (envMode === "failover" || envMode === "round_robin") this.rotationMode = envMode;
  }

  private async legacyRawSetting(): Promise<string> {
    try { const res = await db.execute(sql`SELECT value FROM system_settings WHERE key = ${LEGACY_SETTING} LIMIT 1`); return asText(res.rows[0]?.value); }
    catch { return ""; }
  }

  private async insertPersistedKey(item: ManagedKey): Promise<void> {
    await db.execute(sql`
      INSERT INTO ${sql.raw(TABLE)}
        (id, provider, name, secret_ciphertext, fingerprint, enabled, status, cooldown_until, total_success, total_errors, avg_latency_ms, last_error, last_used_at, source, created_at, updated_at, deleted_at)
      VALUES
        (${item.id}, 'gemini', ${item.name}, ${this.encryptSecret(item.key)}, ${this.fingerprint(item.key)}, ${item.status !== "disabled"}, ${item.status}, ${item.cooldownUntil || null}, ${item.totalSuccess}, ${item.totalErrors}, ${item.avgLatencyMs || null}, ${item.lastError || null}, ${item.lastUsedAt ? new Date(item.lastUsedAt) : null}, ${item.source}, ${new Date(item.createdAt)}, NOW(), NULL)
      ON CONFLICT (fingerprint) DO UPDATE SET
        name = EXCLUDED.name,
        secret_ciphertext = EXCLUDED.secret_ciphertext,
        source = EXCLUDED.source,
        updated_at = NOW(),
        deleted_at = NULL
    `);
  }

  private async migrateLegacyAndEnvironment(): Promise<void> {
    const legacy = await this.legacyRawSetting();
    const candidates = [...this.parseConfiguredEnvKeys()];
    if (legacy) legacy.split(/[,\s\n]+/).map((v) => v.trim()).filter(Boolean).forEach((key, index) => candidates.push({ key, name: `Migrated key ${index + 1}` }));

    const deletedRows = await db.execute(sql`SELECT fingerprint FROM ${sql.raw(TABLE)} WHERE deleted_at IS NOT NULL`);
    const deleted = new Set(deletedRows.rows.map((row) => asText(row.fingerprint)));
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.key.length < 10) continue;
      const fingerprint = this.fingerprint(candidate.key); if (seen.has(fingerprint) || deleted.has(fingerprint)) continue; seen.add(fingerprint);
      const existing = await db.execute(sql`SELECT id FROM ${sql.raw(TABLE)} WHERE fingerprint = ${fingerprint} LIMIT 1`);
      if (existing.rows.length > 0) continue;
      await this.insertPersistedKey({ id: `key-${randomUUID()}`, name: candidate.name, key: candidate.key, status: "healthy", totalSuccess: 0, totalErrors: 0, source: "env", createdAt: new Date().toISOString() });
    }
    if (legacy) {
      try { await db.execute(sql`DELETE FROM system_settings WHERE key = ${LEGACY_SETTING}`); logger.info("Migrated legacy GEMINI_API_KEY setting into encrypted managed key registry"); }
      catch (error) { logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Unable to remove legacy Gemini key setting after migration"); }
    }
  }

  public async hydrateFromDatabase(): Promise<void> {
    if (!this.initialized) await this.initializeDb();
    await this.migrateLegacyAndEnvironment();
    try {
      const modeRes = await db.execute(sql`SELECT value FROM system_settings WHERE key = 'KEY_ROTATION_MODE' LIMIT 1`);
      const dbMode = asText(modeRes.rows[0]?.value); if (dbMode === "failover" || dbMode === "round_robin") this.rotationMode = dbMode;
    } catch { /* keep current mode */ }

    const res = await db.execute(sql`SELECT * FROM ${sql.raw(TABLE)} WHERE provider = 'gemini' AND deleted_at IS NULL ORDER BY created_at ASC`);
    const next = new Map<string, ManagedKey>();
    for (const row of res.rows as DbRow[]) {
      try {
        const encrypted = asText(row.secret_ciphertext); if (!encrypted) continue;
        const status = asText(row.status) as KeyStatus;
        next.set(asText(row.id), {
          id: asText(row.id), name: asText(row.name) || "Gemini key", key: this.decryptSecret(encrypted),
          status: ["healthy", "cooldown", "disabled", "invalid"].includes(status) ? status : "healthy",
          cooldownUntil: row.cooldown_until ? asNumber(row.cooldown_until) : undefined,
          lastError: asText(row.last_error) || undefined,
          totalSuccess: asNumber(row.total_success), totalErrors: asNumber(row.total_errors),
          lastUsedAt: row.last_used_at ? asDateIso(row.last_used_at) : undefined,
          source: asText(row.source) === "dashboard" ? "dashboard" : "env",
          createdAt: asDateIso(row.created_at), avgLatencyMs: row.avg_latency_ms ? asNumber(row.avg_latency_ms) : undefined,
        });
      } catch (error) { logger.error({ id: asText(row.id), error: error instanceof Error ? error.message : String(error) }, "Failed to decrypt managed Gemini API key"); }
    }
    this.keys = next; this.currentIndex = 0;
    const joined = Array.from(this.keys.values()).map((item) => item.key).join(","); if (joined) process.env.GEMINI_API_KEY = joined;
    logger.info({ totalKeys: this.keys.size }, "Managed Gemini API-key registry hydrated from PostgreSQL");
  }

  public async reloadFromDatabase(): Promise<void> { await this.hydrateFromDatabase(); }
  public getRotationMode(): RotationMode { return this.rotationMode; }
  public getJoinedRawKeys(): string { return Array.from(this.keys.values()).map((item) => item.key).join(","); }
  public setRotationMode(mode: RotationMode): void { this.rotationMode = mode; process.env.KEY_ROTATION_MODE = mode; }

  public getSummary(): KeyPoolSummary {
    const now = Date.now(); let healthyKeys = 0, inCooldownKeys = 0, disabledKeys = 0, invalidKeys = 0; const keys: ManagedKeyPublicInfo[] = [];
    for (const item of this.keys.values()) {
      let status = item.status; let cooldownSecondsLeft = 0;
      if (status === "cooldown" && item.cooldownUntil) {
        if (now >= item.cooldownUntil) { item.status = "healthy"; delete item.cooldownUntil; status = "healthy"; void this.persistHealth(item); }
        else cooldownSecondsLeft = Math.ceil((item.cooldownUntil - now) / 1000);
      }
      if (status === "healthy") healthyKeys += 1; else if (status === "cooldown") inCooldownKeys += 1; else if (status === "disabled") disabledKeys += 1; else if (status === "invalid") invalidKeys += 1;
      keys.push(this.toPublic(item, cooldownSecondsLeft));
    }
    return { rotationMode: this.rotationMode, totalKeys: this.keys.size, healthyKeys, inCooldownKeys, disabledKeys, invalidKeys, keys };
  }

  public async addKey(key: string, name?: string): Promise<ManagedKeyPublicInfo> {
    const clean = key.trim(); if (!clean || clean.length < 10) throw new Error("Invalid API key format."); if (!this.initialized) await this.initializeDb();
    const fingerprint = this.fingerprint(clean);
    const existing = await db.execute(sql`SELECT id, name, deleted_at, created_at FROM ${sql.raw(TABLE)} WHERE fingerprint = ${fingerprint} LIMIT 1`);
    if (existing.rows.length > 0 && !existing.rows[0].deleted_at) throw new Error(`This API key is already configured as "${asText(existing.rows[0].name)}".`);
    const testResult = await this.testRawKey(clean); if (!testResult.valid) throw new Error(`API key validation failed: ${testResult.error || "Unable to authenticate with Gemini"}`);
    const id = asText(existing.rows[0]?.id) || `key-${randomUUID()}`; const keyName = name?.trim() || `Gemini key ${this.keys.size + 1}`; const durationMs = (testResult.retryDelaySeconds || 45) * 1000;
    const managed: ManagedKey = { id, name: keyName, key: clean, status: testResult.isRateLimited ? "cooldown" : "healthy", cooldownUntil: testResult.isRateLimited ? Date.now() + durationMs : undefined, totalSuccess: testResult.isRateLimited ? 0 : 1, totalErrors: testResult.isRateLimited ? 1 : 0, lastError: testResult.isRateLimited ? testResult.notice : undefined, source: "dashboard", createdAt: existing.rows[0]?.created_at ? asDateIso(existing.rows[0].created_at) : new Date().toISOString(), avgLatencyMs: testResult.latencyMs };
    await this.insertPersistedKey(managed); this.keys.set(id, managed); process.env.GEMINI_API_KEY = this.getJoinedRawKeys(); return this.toPublic(managed);
  }

  public async removeKey(id: string): Promise<{ removed: boolean; source?: KeySource }> {
    const item = this.keys.get(id);
    if (!item) {
      const row = await db.execute(sql`SELECT source FROM ${sql.raw(TABLE)} WHERE id = ${id} LIMIT 1`); if (row.rows.length === 0) return { removed: false };
      const source: KeySource = asText(row.rows[0].source) === "dashboard" ? "dashboard" : "env";
      if (source === "dashboard") await db.execute(sql`DELETE FROM ${sql.raw(TABLE)} WHERE id = ${id}`); else await db.execute(sql`UPDATE ${sql.raw(TABLE)} SET enabled = FALSE, deleted_at = NOW(), updated_at = NOW() WHERE id = ${id}`);
      return { removed: true, source };
    }
    if (item.source === "dashboard") await db.execute(sql`DELETE FROM ${sql.raw(TABLE)} WHERE id = ${id}`);
    else await db.execute(sql`UPDATE ${sql.raw(TABLE)} SET enabled = FALSE, deleted_at = NOW(), updated_at = NOW() WHERE id = ${id}`);
    this.keys.delete(id); process.env.GEMINI_API_KEY = this.getJoinedRawKeys(); return { removed: true, source: item.source };
  }

  public async toggleKey(id: string): Promise<ManagedKeyPublicInfo | null> {
    const item = this.keys.get(id); if (!item) return null; item.status = item.status === "disabled" ? "healthy" : "disabled"; delete item.cooldownUntil; await this.persistHealth(item); return this.toPublic(item);
  }

  private toPublic(item: ManagedKey, cooldownSecondsLeft?: number): ManagedKeyPublicInfo {
    const seconds = cooldownSecondsLeft ?? (item.status === "cooldown" && item.cooldownUntil ? Math.max(0, Math.ceil((item.cooldownUntil - Date.now()) / 1000)) : 0);
    return { id: item.id, name: item.name, maskedKey: this.mask(item.key), status: item.status, cooldownSecondsLeft: seconds, lastError: item.lastError, totalSuccess: item.totalSuccess, totalErrors: item.totalErrors, lastUsedAt: item.lastUsedAt, source: item.source, createdAt: item.createdAt, avgLatencyMs: item.avgLatencyMs };
  }

  private async persistHealth(item: ManagedKey): Promise<void> {
    try {
      await db.execute(sql`UPDATE ${sql.raw(TABLE)} SET enabled = ${item.status !== "disabled"}, status = ${item.status}, cooldown_until = ${item.cooldownUntil || null}, total_success = ${item.totalSuccess}, total_errors = ${item.totalErrors}, avg_latency_ms = ${item.avgLatencyMs || null}, last_error = ${item.lastError || null}, last_used_at = ${item.lastUsedAt ? new Date(item.lastUsedAt) : null}, updated_at = NOW() WHERE id = ${item.id}`);
    } catch (error) { logger.warn({ id: item.id, error: error instanceof Error ? error.message : String(error) }, "Failed to persist API-key health state"); }
  }

  public async testRawKey(rawKey: string): Promise<{ valid: boolean; latencyMs: number; error?: string; isRateLimited?: boolean; retryDelaySeconds?: number; notice?: string }> {
    const start = Date.now();
    try {
      const model = process.env.GEMINI_MODEL?.trim() || process.env.GEMINI_MODEL_FAST?.trim() || process.env.GEMINI_MODEL_REASONING?.trim() || process.env.GEMINI_MODEL_POOL?.split(",").map((item) => item.trim()).find(Boolean);
      if (!model) return { valid: false, latencyMs: Date.now() - start, error: "No configured generative Gemini model is available for key validation" };
      const client = new GoogleGenAI({ apiKey: rawKey.trim() });
      const response = await client.models.generateContent({ model, contents: [{ role: "user", parts: [{ text: "ping" }] }], config: { maxOutputTokens: 5 } });
      return { valid: Boolean(response), latencyMs: Date.now() - start };
    } catch (error) {
      const latencyMs = Date.now() - start; const errorMsg = error instanceof Error ? error.message : String(error);
      if (/429|RESOURCE_EXHAUSTED|quota|rate limit|ResourceExhausted/i.test(errorMsg)) { const match = errorMsg.match(/retry(?:Delay| in)[^\d]*(\d+(?:\.\d+)?)/i); const retrySeconds = match?.[1] ? Math.max(1, Math.ceil(Number(match[1]))) : 45; return { valid: true, isRateLimited: true, retryDelaySeconds: retrySeconds, latencyMs, notice: `Key authenticated with Gemini but is currently rate-limited (approximately ${retrySeconds}s cooldown).` }; }
      return { valid: false, latencyMs, error: errorMsg };
    }
  }

  public getOrderedKeysForExecution(): ManagedKey[] {
    const healthy = this.getHealthyCandidateKeys();
    if (healthy.length === 0) { const nonDisabled = Array.from(this.keys.values()).filter((item) => item.status !== "disabled"); return nonDisabled.length > 0 ? nonDisabled.sort((a, b) => (a.cooldownUntil || 0) - (b.cooldownUntil || 0)) : Array.from(this.keys.values()); }
    if (this.rotationMode === "failover") return healthy;
    const start = this.currentIndex % healthy.length; this.currentIndex = (this.currentIndex + 1) % healthy.length; return healthy.map((_, index) => healthy[(start + index) % healthy.length]);
  }

  public getHealthyCandidateKeys(): ManagedKey[] {
    const now = Date.now(); const candidates: ManagedKey[] = [];
    for (const item of this.keys.values()) {
      if (item.status === "disabled" || item.status === "invalid") continue;
      if (item.status === "cooldown" && item.cooldownUntil) { if (now >= item.cooldownUntil) { item.status = "healthy"; delete item.cooldownUntil; void this.persistHealth(item); candidates.push(item); } }
      else if (item.status === "healthy") candidates.push(item);
    }
    return candidates;
  }

  public recordSuccess(id: string, latencyMs?: number): void {
    const item = this.keys.get(id); if (!item) return; item.totalSuccess += 1; item.status = "healthy"; delete item.cooldownUntil; item.lastUsedAt = new Date().toISOString(); if (latencyMs && latencyMs > 0) item.avgLatencyMs = item.avgLatencyMs ? Math.round((item.avgLatencyMs * 9 + latencyMs) / 10) : latencyMs; void this.persistHealth(item);
  }

  public recordError(id: string, error: unknown): void {
    const item = this.keys.get(id); if (!item) return; item.totalErrors += 1; const errorStr = error instanceof Error ? error.message : String(error); item.lastError = errorStr.slice(0, 200);
    if (/429|RESOURCE_EXHAUSTED|quota|rate limit|ResourceExhausted/i.test(errorStr)) { item.status = "cooldown"; item.cooldownUntil = Date.now() + this.defaultCooldownMs; logger.warn({ id: item.id, name: item.name }, "Gemini API key entered cooldown"); }
    else if (/API_KEY_INVALID|401|403/i.test(errorStr)) { item.status = "invalid"; logger.error({ id: item.id, name: item.name }, "Gemini API key marked invalid"); }
    void this.persistHealth(item);
  }
}

export const apiKeyPoolService = new ApiKeyPoolService();
