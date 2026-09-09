import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiKeyPoolService } from "../src/services/api-key-pool.service";

describe("ApiKeyPoolService", () => {
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEYS;
    for (let i = 1; i <= 20; i++) {
      delete process.env[`GEMINI_API_KEY_${i}`];
    }
  });

  it("initializes with multiple keys from environment variables and formats summary correctly", () => {
    process.env.GEMINI_API_KEY = "AIzaSyFakeKeyNumber1XXXXXXXXXX";
    process.env.GEMINI_API_KEYS = "AIzaSyFakeKeyNumber2XXXXXXXXXX, AIzaSyFakeKeyNumber3XXXXXXXXXX";
    process.env.GEMINI_API_KEY_4 = "AIzaSyFakeKeyNumber4XXXXXXXXXX";

    const pool = new ApiKeyPoolService();
    const summary = pool.getSummary();

    expect(summary.totalKeys).toBe(4);
    expect(summary.healthyKeys).toBe(4);
    expect(summary.inCooldownKeys).toBe(0);
    expect(summary.keys[0].maskedKey).toBe("AIzaSy...XXXX");
  });

  it("supports round-robin rotation across multiple keys", () => {
    process.env.GEMINI_API_KEYS = "AIzaSyKey11111111111111111111, AIzaSyKey22222222222222222222, AIzaSyKey33333333333333333333";
    const pool = new ApiKeyPoolService();
    pool.setRotationMode("round_robin");

    const ordered1 = pool.getOrderedKeysForExecution();
    const ordered2 = pool.getOrderedKeysForExecution();
    const ordered3 = pool.getOrderedKeysForExecution();

    expect(ordered1[0].name).toContain("Key 1");
    expect(ordered2[0].name).toContain("Key 2");
    expect(ordered3[0].name).toContain("Key 3");
  });

  it("handles failover when a key enters cooldown after a 429 quota error", () => {
    process.env.GEMINI_API_KEYS = "AIzaSyKeyPrimary1111111111111, AIzaSyKeyBackup2222222222222";
    const pool = new ApiKeyPoolService();
    pool.setRotationMode("failover");

    const initialKeys = pool.getOrderedKeysForExecution();
    const primaryId = initialKeys[0].id;

    // Simulate 429 quota exhaustion
    pool.recordError(primaryId, new Error("429 ResourceExhausted: quota limit reached"));

    const summary = pool.getSummary();
    expect(summary.inCooldownKeys).toBe(1);
    expect(summary.healthyKeys).toBe(1);

    // In failover mode, the healthy backup key should now be first
    const failoverKeys = pool.getOrderedKeysForExecution();
    expect(failoverKeys[0].id).not.toBe(primaryId);
    expect(failoverKeys[0].name).toContain("Key 2");
  });

  it("allows toggling keys between enabled and disabled states", () => {
    process.env.GEMINI_API_KEY = "AIzaSyKeySingle1111111111111";
    const pool = new ApiKeyPoolService();

    const summaryBefore = pool.getSummary();
    const keyId = summaryBefore.keys[0].id;

    pool.toggleKey(keyId);
    expect(pool.getSummary().keys[0].status).toBe("disabled");
    expect(pool.getSummary().healthyKeys).toBe(0);

    pool.toggleKey(keyId);
    expect(pool.getSummary().keys[0].status).toBe("healthy");
    expect(pool.getSummary().healthyKeys).toBe(1);
  });

  it("successfully adds a key in cooldown status when the key receives a 429 quota error", async () => {
    const pool = new ApiKeyPoolService();
    // Clean up any stale test key from previous runs
    try {
      const summary = pool.getSummary();
      for (const k of summary.keys) {
        if (k.name.includes("Rate Limited") || k.name.includes("Test")) {
          await pool.removeKey(k.id);
        }
      }
    } catch {}

    // Mock testRawKey to simulate a 429 quota response from Gemini
    vi.spyOn(pool, "testRawKey").mockResolvedValue({
      valid: true,
      isRateLimited: true,
      retryDelaySeconds: 40,
      latencyMs: 120,
      notice: "Key is authenticated with Gemini, but currently in rate-limit quota cooldown (~40s).",
    });

    const uniqueKey = `AIzaSyNewKeyInCooldown_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const added = await pool.addKey(uniqueKey, "Key 4 (Rate Limited)");

    try {
      expect(added.status).toBe("cooldown");
      expect(added.cooldownSecondsLeft).toBeGreaterThan(0);
      expect(pool.getSummary().totalKeys).toBe(1);
      expect(pool.getSummary().inCooldownKeys).toBe(1);
    } finally {
      await pool.removeKey(added.id);
    }
  });
});
