import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app";
import { authService } from "../src/services/auth.service";
import { telegramIdentityService } from "../src/services/telegram-identity.service";
import { healthMonitorService } from "../src/services/health-monitor.service";
import fs from "node:fs";
import path from "node:path";

describe("Zero-Fallback & Security Enforcement Suite", () => {
  it("strictly enforces DTO allowlist on /api/user/overview with zero infrastructure leaks", async () => {
    const { sessionToken } = await authService.handleGoogleAuth({
      email: "security-audit-user@example.com",
      name: "Security Audit User",
      emailVerified: true,
    });

    const res = await request(app)
      .get("/api/user/overview")
      .set("Authorization", `Bearer ${sessionToken}`);

    expect(res.status).toBe(200);
    const body = res.body;

    const allowedKeys = new Set([
      "user",
      "assistant",
      "telegram",
      "metrics",
      "recentTasks",
      "recentMemories",
      "quickPrompts",
      "updatedAt",
    ]);

    Object.keys(body).forEach((key) => {
      expect(allowedKeys.has(key)).toBe(true);
    });

    const payload = JSON.stringify(body);
    const forbiddenTelemetry = [
      "keyPool",
      "partitionId",
      "healthyKeys",
      "inCooldownKeys",
      "circuitBreaker",
      "healthMatrix",
      "activeModel",
    ];

    forbiddenTelemetry.forEach((forbidden) => {
      expect(payload.includes(`"${forbidden}"`)).toBe(false);
    });
  });

  it("verifies healthMonitorService calculates explainable health state", () => {
    // Record sample operations
    healthMonitorService.recordSample(true, 120, "gemini");
    healthMonitorService.recordSample(true, 140, "groq");

    const health = healthMonitorService.evaluateHealth();
    expect(["ready", "degraded", "offline"]).toContain(health.status);
    expect(typeof health.statusLabel).toBe("string");
    expect(typeof health.details).toBe("string");
    expect(typeof health.criteria).toBe("string");
  });

  it("generates and consumes single-use 5-minute magic tokens", async () => {
    const magic = await authService.generateMagicLoginToken(99887766, "test_magic_user");
    expect(magic.token).toBeDefined();
    expect(magic.magicUrl).toContain("magic_");

    // First consumption: success
    const authResult = await authService.consumeMagicLoginToken(magic.token);
    expect(authResult).not.toBeNull();
    expect(authResult!.user.telegramUserId).toBe(99887766);
    expect(typeof authResult!.sessionToken).toBe("string");

    // Second consumption: fails (single-use)
    const secondAttempt = await authService.consumeMagicLoginToken(magic.token);
    expect(secondAttempt).toBeNull();
  });

  it("prevents silent Google account takeovers when conflicting Telegram IDs exist", async () => {
    // User A registered with Telegram ID 111111
    await authService.handleGoogleAuth({
      email: "conflict-test@example.com",
      name: "User One",
      emailVerified: true,
      telegramLinkingContext: { telegramUserId: 111111 },
    });

    // An attacker or different Telegram user tries to claim the same Google email with Telegram ID 222222
    await expect(
      authService.handleGoogleAuth({
        email: "conflict-test@example.com",
        name: "User Two",
        emailVerified: true,
        telegramLinkingContext: { telegramUserId: 222222 },
      })
    ).rejects.toThrow(/Conflict/);
  });

  it("rejects unverified Google emails", async () => {
    await expect(
      authService.handleGoogleAuth({
        email: "unverified@example.com",
        name: "Unverified User",
        emailVerified: false,
      })
    ).rejects.toThrow(/Unverified Google email/);
  });

  it("verifies zero hardcoded 'WingbuddyAiBot' strings in active source code", () => {
    const searchDirs = ["src", "views", "telegram", "services", "routes"];
    const baseDir = path.resolve(__dirname, "../src");

    function scanDir(dir: string): void {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          scanDir(fullPath);
        } else if (file.endsWith(".ts") || file.endsWith(".js") || file.endsWith(".html")) {
          const content = fs.readFileSync(fullPath, "utf-8");
          expect(content.includes("WingbuddyAiBot")).toBe(false);
        }
      }
    }

    scanDir(baseDir);
  });
});
