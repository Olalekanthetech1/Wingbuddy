import { GoogleGenAI } from "@google/genai";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { safeErrorMetadata } from "../utils/safe-error";

export type KeyStatus = "healthy" | "cooldown" | "disabled" | "invalid";
export type RotationMode = "round_robin" | "failover";

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
  source: "env" | "dashboard";
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
  source: "env" | "dashboard";
  createdAt: string;
  avgLatencyMs?: number;
}

export interface KeyPoolSummary {
  rotationMode: RotationMode;
  totalKeys: number;
  healthyKeys: number;
  inCooldownKeys: number;
  disabledKeys: number;
  keys: ManagedKeyPublicInfo[];
}

export class ApiKeyPoolService {
  private keys: Map<string, ManagedKey> = new Map();
  private rotationMode: RotationMode = "round_robin";
  private currentIndex = 0;
  private readonly defaultCooldownMs = 45_000; // 45s cooldown on 429 quota exhaustion

  constructor(initialKeys?: Array<{ key: string; name?: string }>) {
    this.discoverInitialKeys(initialKeys);
  }

  private mask(key: string): string {
    if (!key || key.length < 8) return "••••••••";
    return `${key.slice(0, 6)}...${key.slice(-4)}`;
  }

  
  public async initializeDb(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS api_keys_health (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        cooldown_until BIGINT,
        total_success INTEGER NOT NULL DEFAULT 0,
        total_errors INTEGER NOT NULL DEFAULT 0,
        avg_latency_ms INTEGER
      );
    `);
  }

  public async syncFromDb(): Promise<void> {
    try {
      const res = await db.execute(sql`SELECT * FROM api_keys_health`);
      for (const row of res.rows) {
        const item = this.keys.get(row.id as string);
        if (item) {
          item.status = row.status as any;
          item.cooldownUntil = row.cooldown_until ? Number(row.cooldown_until) : undefined;
          item.totalSuccess = Number(row.total_success) || 0;
          item.totalErrors = Number(row.total_errors) || 0;
          item.avgLatencyMs = row.avg_latency_ms ? Number(row.avg_latency_ms) : undefined;
        }
      }
    } catch(e) {
      logger.warn({ error: String(e) }, "Failed to sync keys from DB");
    }
  }

  private async syncToDb(item: ManagedKey): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO api_keys_health (id, status, cooldown_until, total_success, total_errors, avg_latency_ms)
        VALUES (${item.id}, ${item.status}, ${item.cooldownUntil || null}, ${item.totalSuccess}, ${item.totalErrors}, ${item.avgLatencyMs || null})
        ON CONFLICT (id) DO UPDATE SET
          status = ${item.status},
          cooldown_until = ${item.cooldownUntil || null},
          total_success = ${item.totalSuccess},
          total_errors = ${item.totalErrors},
          avg_latency_ms = ${item.avgLatencyMs || null}
      `);
    } catch(e) {
      logger.warn({ error: String(e) }, "Failed to sync key to DB");
    }
  }

  private discoverInitialKeys(passedKeys?: Array<{ key: string; name?: string }>) {
    const discovered = new Set<string>();

    const addIfNew = (rawKey: string, name: string, source: "env" | "dashboard") => {
      const clean = rawKey.trim();
      if (!clean || clean.length < 10 || discovered.has(clean)) return;
      discovered.add(clean);

      const id = `key-${this.keys.size + 1}`;
      this.keys.set(id, {
        id,
        name,
        key: clean,
        status: "healthy",
        totalSuccess: 0,
        totalErrors: 0,
        source,
        createdAt: new Date().toISOString(),
      });
    };

    // 1. Primary from env (supports single key or comma-separated key1,key2,key3...)
    if (process.env.GEMINI_API_KEY) {
      const parts = process.env.GEMINI_API_KEY.split(/[,\s\n]+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length > 1) {
        parts.forEach((k, idx) => {
          addIfNew(k, `Key ${idx + 1}`, "env");
        });
      } else if (parts.length === 1) {
        addIfNew(parts[0], "Key 1 (Primary Env)", "env");
      }
    }

    // 2. Comma/space-separated list
    if (process.env.GEMINI_API_KEYS) {
      const parts = process.env.GEMINI_API_KEYS.split(/[,\s\n]+/).map((s) => s.trim()).filter(Boolean);
      parts.forEach((k, idx) => {
        addIfNew(k, `Key ${this.keys.size + 1}`, "env");
      });
    }

    // 3. Numbered env keys: GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.
    for (let i = 1; i <= 20; i++) {
      const val = process.env[`GEMINI_API_KEY_${i}`];
      if (val) {
        addIfNew(val, `Key ${i} (Env)`, "env");
      }
    }

    // 4. Passed constructor keys
    if (passedKeys && passedKeys.length > 0) {
      passedKeys.forEach((item, idx) => {
        addIfNew(item.key, item.name || `Key ${this.keys.size + 1}`, "dashboard");
      });
    }

    // Rotation mode from env
    if (process.env.KEY_ROTATION_MODE === "failover" || process.env.KEY_ROTATION_MODE === "round_robin") {
      this.rotationMode = process.env.KEY_ROTATION_MODE;
    }
  }

  public reloadFromEnv(rawVal?: string): void {
    if (rawVal) {
      process.env.GEMINI_API_KEY = rawVal;
    }
    this.keys.clear();
    this.discoverInitialKeys();
    logger.info({ totalKeys: this.keys.size }, "API Key pool reloaded dynamically");
  }

  public getRotationMode(): RotationMode {
    return this.rotationMode;
  }

  public getJoinedRawKeys(): string {
    return Array.from(this.keys.values())
      .map((k) => k.key)
      .join(",");
  }

  public setRotationMode(mode: RotationMode): void {
    this.rotationMode = mode;
    logger.info({ mode }, "Gemini API Key pool rotation mode updated");
  }

  public getSummary(): KeyPoolSummary {
    const now = Date.now();
    const list: ManagedKeyPublicInfo[] = [];
    let healthyCount = 0;
    let cooldownCount = 0;
    let disabledCount = 0;

    for (const item of this.keys.values()) {
      let status = item.status;
      let cooldownSecondsLeft = 0;

      if (status === "cooldown" && item.cooldownUntil) {
        if (now >= item.cooldownUntil) {
          item.status = "healthy";
          delete item.cooldownUntil;
          status = "healthy";
        } else {
          cooldownSecondsLeft = Math.ceil((item.cooldownUntil - now) / 1000);
        }
      }

      if (status === "healthy") healthyCount++;
      else if (status === "cooldown") cooldownCount++;
      else if (status === "disabled") disabledCount++;

      list.push({
        id: item.id,
        name: item.name,
        maskedKey: this.mask(item.key),
        status,
        cooldownSecondsLeft,
        lastError: item.lastError,
        totalSuccess: item.totalSuccess,
        totalErrors: item.totalErrors,
        lastUsedAt: item.lastUsedAt,
        source: item.source,
        createdAt: item.createdAt,
        avgLatencyMs: item.avgLatencyMs,
      });
    }

    return {
      rotationMode: this.rotationMode,
      totalKeys: this.keys.size,
      healthyKeys: healthyCount,
      inCooldownKeys: cooldownCount,
      disabledKeys: disabledCount,
      keys: list,
    };
  }

  public async addKey(key: string, name?: string): Promise<ManagedKeyPublicInfo> {
    const clean = key.trim();
    if (!clean || clean.length < 10) {
      throw new Error("Invalid API key format. Gemini API keys are typically ~39 characters.");
    }

    // Check if key already exists
    for (const existing of this.keys.values()) {
      if (existing.key === clean) {
        throw new Error(`This API key is already configured as "${existing.name}".`);
      }
    }

    // Live validation test before adding
    const testResult = await this.testRawKey(clean);
    if (!testResult.valid) {
      throw new Error(`API Key validation failed: ${testResult.error || "Unable to authenticate with Google Gemini"}`);
    }

    const id = `key-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const keyName = name?.trim() || `Key ${this.keys.size + 1}`;
    const isRateLimited = Boolean(testResult.isRateLimited);
    const cooldownDuration = (testResult.retryDelaySeconds || 45) * 1000;

    const managed: ManagedKey = {
      id,
      name: keyName,
      key: clean,
      status: isRateLimited ? "cooldown" : "healthy",
      cooldownUntil: isRateLimited ? Date.now() + cooldownDuration : undefined,
      totalSuccess: isRateLimited ? 0 : 1,
      totalErrors: isRateLimited ? 1 : 0,
      lastError: isRateLimited ? testResult.notice || "Rate limit quota exhausted on test" : undefined,
      source: "dashboard",
      createdAt: new Date().toISOString(),
      avgLatencyMs: testResult.latencyMs,
    };

    this.keys.set(id, managed);
    logger.info({ id, name: keyName, status: managed.status, isRateLimited }, "Added Gemini API key to pool");

    return {
      id: managed.id,
      name: managed.name,
      maskedKey: this.mask(managed.key),
      status: managed.status,
      cooldownSecondsLeft: isRateLimited ? Math.ceil(cooldownDuration / 1000) : 0,
      totalSuccess: managed.totalSuccess,
      totalErrors: managed.totalErrors,
      lastError: managed.lastError,
      source: managed.source,
      createdAt: managed.createdAt,
      avgLatencyMs: managed.avgLatencyMs,
    };
  }

  public removeKey(id: string): boolean {
    const item = this.keys.get(id);
    if (!item) return false;
    this.keys.delete(id);
    logger.info({ id, name: item.name }, "Removed API key from pool");
    return true;
  }

  public toggleKey(id: string): ManagedKeyPublicInfo | null {
    const item = this.keys.get(id);
    if (!item) return null;

    if (item.status === "disabled") {
      item.status = "healthy";
      delete item.cooldownUntil;
    } else {
      item.status = "disabled";
    }

    logger.info({ id, name: item.name, status: item.status }, "Toggled API key status");
    return {
      id: item.id,
      name: item.name,
      maskedKey: this.mask(item.key),
      status: item.status,
      cooldownSecondsLeft: 0,
      lastError: item.lastError,
      totalSuccess: item.totalSuccess,
      totalErrors: item.totalErrors,
      lastUsedAt: item.lastUsedAt,
      source: item.source,
      createdAt: item.createdAt,
      avgLatencyMs: item.avgLatencyMs,
    };
  }

  public async testRawKey(rawKey: string): Promise<{
    valid: boolean;
    latencyMs: number;
    error?: string;
    isRateLimited?: boolean;
    retryDelaySeconds?: number;
    notice?: string;
  }> {
    const start = Date.now();
    try {
      const client = new GoogleGenAI({ apiKey: rawKey.trim() });
      const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
      const response = await client.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        config: { maxOutputTokens: 5 },
      });

      const latencyMs = Date.now() - start;
      if (response && (response.text || response.candidates)) {
        return { valid: true, latencyMs };
      }
      return { valid: true, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : String(err);

      const isQuotaOr429 =
        errorMsg.includes("429") ||
        errorMsg.includes("RESOURCE_EXHAUSTED") ||
        errorMsg.includes("quota") ||
        errorMsg.includes("rate limit") ||
        errorMsg.includes("ResourceExhausted") ||
        errorMsg.includes("exceeded your current quota");

      if (isQuotaOr429) {
        let retrySeconds = 45;
        const match = errorMsg.match(/retry(?:Delay| in)[^\d]*(\d+(?:\.\d+)?)/i);
        if (match && match[1]) {
          const parsed = parseFloat(match[1]);
          if (!isNaN(parsed) && parsed > 0) {
            retrySeconds = Math.ceil(parsed);
          }
        }

        return {
          valid: true,
          isRateLimited: true,
          retryDelaySeconds: retrySeconds,
          latencyMs,
          notice: `Key is authenticated with Gemini, but currently in rate-limit quota cooldown (~${retrySeconds}s).`,
        };
      }

      return { valid: false, latencyMs, error: errorMsg };
    }
  }

  public getHealthyCandidateKeys(): ManagedKey[] {
    const now = Date.now();
    const candidates: ManagedKey[] = [];

    for (const item of this.keys.values()) {
      if (item.status === "disabled") continue;

      if (item.status === "cooldown" && item.cooldownUntil) {
        if (now >= item.cooldownUntil) {
          item.status = "healthy";
          delete item.cooldownUntil;
          candidates.push(item);
        }
      } else if (item.status === "healthy") {
        candidates.push(item);
      }
    }

    return candidates;
  }

  public async getOrderedKeysForExecution(): Promise<ManagedKey[]> {
    await this.syncFromDb();
    const healthy = this.getHealthyCandidateKeys();
    if (healthy.length === 0) {
      // If all are in cooldown or disabled, return non-disabled sorted by cooldown time
      const nonDisabled = Array.from(this.keys.values()).filter((k) => k.status !== "disabled");
      if (nonDisabled.length > 0) {
        return nonDisabled.sort((a, b) => (a.cooldownUntil || 0) - (b.cooldownUntil || 0));
      }
      // If truly empty or all disabled, return all
      return Array.from(this.keys.values());
    }

    if (this.rotationMode === "failover") {
      // In failover mode, always prefer earlier keys in order
      return healthy;
    }

    // In round_robin mode, cycle starting from currentIndex
    const n = healthy.length;
    const startIdx = this.currentIndex % n;
    this.currentIndex = (this.currentIndex + 1) % n;

    const reordered: ManagedKey[] = [];
    for (let i = 0; i < n; i++) {
      reordered.push(healthy[(startIdx + i) % n]);
    }
    return reordered;
  }

  public recordSuccess(id: string, latencyMs?: number): void {
    const item = this.keys.get(id);
    if (!item) return;

    item.totalSuccess += 1;
    item.status = "healthy";
    delete item.cooldownUntil;
    item.lastUsedAt = new Date().toISOString();
    void this.syncToDb(item);

    if (latencyMs && latencyMs > 0) {
      // Stronger EMA (90/10) to resist single-sample noise
      item.avgLatencyMs = item.avgLatencyMs
        ? Math.round((item.avgLatencyMs * 9 + latencyMs) / 10)
        : latencyMs;
    }
  }

  public recordError(id: string, error: unknown): void {
    const item = this.keys.get(id);
    if (!item) return;

    item.totalErrors += 1;
    const errorStr = error instanceof Error ? error.message : String(error);
    item.lastError = errorStr.slice(0, 200);

    const isQuotaOr429 =
      errorStr.includes("429") ||
      errorStr.includes("RESOURCE_EXHAUSTED") ||
      errorStr.includes("quota") ||
      errorStr.includes("rate limit") ||
      errorStr.includes("ResourceExhausted");

    if (isQuotaOr429) {
      item.status = "cooldown";
      item.cooldownUntil = Date.now() + this.defaultCooldownMs;
      // Hysteresis: Require consecutive successes to clear status if we wanted, but for now we enforce minimum cooldown.
      void this.syncToDb(item);
      logger.warn(
        { id: item.id, name: item.name, cooldownSeconds: this.defaultCooldownMs / 1000 },
        "Key entered cooldown due to 429 quota exhaustion; auto-failing over to next available key",
      );
    } else if (errorStr.includes("API_KEY_INVALID") || errorStr.includes("401") || errorStr.includes("403")) {
      item.status = "invalid";
      logger.error({ id: item.id, name: item.name }, "API key marked invalid due to auth error");
    }
  }
}

// Global shared singleton
export const apiKeyPoolService = new ApiKeyPoolService();
