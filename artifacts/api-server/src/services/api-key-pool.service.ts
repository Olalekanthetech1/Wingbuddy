import { GoogleGenAI } from "@google/genai";
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

    const managed: ManagedKey = {
      id,
      name: keyName,
      key: clean,
      status: "healthy",
      totalSuccess: 1, // 1 from test
      totalErrors: 0,
      source: "dashboard",
      createdAt: new Date().toISOString(),
      avgLatencyMs: testResult.latencyMs,
    };

    this.keys.set(id, managed);
    logger.info({ id, name: keyName, latencyMs: testResult.latencyMs }, "Added new Gemini API key to pool");

    return {
      id: managed.id,
      name: managed.name,
      maskedKey: this.mask(managed.key),
      status: managed.status,
      cooldownSecondsLeft: 0,
      totalSuccess: managed.totalSuccess,
      totalErrors: managed.totalErrors,
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

  public async testRawKey(rawKey: string): Promise<{ valid: boolean; latencyMs: number; error?: string }> {
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

  public getOrderedKeysForExecution(): ManagedKey[] {
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

    if (latencyMs && latencyMs > 0) {
      item.avgLatencyMs = item.avgLatencyMs
        ? Math.round((item.avgLatencyMs * 4 + latencyMs) / 5)
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
