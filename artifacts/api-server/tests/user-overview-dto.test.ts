import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app";
import { authService } from "../src/services/auth.service";

describe("GET /api/user/overview DTO Enforcement", () => {
  it("returns only allowlisted user-facing fields and zero internal infrastructure telemetry", async () => {
    const { sessionToken } = await authService.handleGoogleAuth({
      email: "dto-test-user@example.com",
      name: "DTO Test User",
    });

    const res = await request(app)
      .get("/api/user/overview")
      .set("Authorization", `Bearer ${sessionToken}`);

    expect(res.status).toBe(200);
    const body = res.body;

    // Allowlisted top-level keys
    const allowedTopLevelKeys = new Set([
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
      expect(allowedTopLevelKeys.has(key)).toBe(true);
    });

    // Strictly verify forbidden infrastructure/developer keys do NOT exist anywhere in the payload
    const payloadString = JSON.stringify(body);
    const forbiddenPatterns = [
      "keyPool",
      "healthyKeys",
      "totalKeys",
      "inCooldownKeys",
      "partitionId",
      "circuitBreaker",
      "healthMatrix",
      "activeModel",
    ];

    forbiddenPatterns.forEach((forbidden) => {
      expect(payloadString.includes(`"${forbidden}"`)).toBe(false);
    });

    // Verify user object fields
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe("dto-test-user@example.com");
    expect(body.user.partitionId).toBeUndefined();

    // Verify assistant object is user-translated
    expect(body.assistant).toBeDefined();
    expect(["ready", "degraded", "offline"]).toContain(body.assistant.status);
    expect(typeof body.assistant.statusLabel).toBe("string");

    // Verify metrics structure
    expect(body.metrics).toBeDefined();
    expect(typeof body.metrics.memories.count).toBe("number");
    expect(typeof body.metrics.tasks.total).toBe("number");
    expect(typeof body.metrics.reminders.total).toBe("number");
    expect(typeof body.metrics.messages.total).toBe("number");
  });
});
