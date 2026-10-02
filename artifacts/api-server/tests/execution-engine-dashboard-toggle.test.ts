import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../src/app";
import {
  isExecutionEngineEnabled,
  setExecutionEngineEnabled,
  toggleExecutionEngine,
  getExecutionConfig,
} from "../src/execution/config";
import { authService } from "../src/services/auth.service";
import { getPool } from "@workspace/db";

describe("Execution Engine Dynamic Dashboard Toggle", () => {
  let adminSessionToken: string;

  beforeEach(async () => {
    setExecutionEngineEnabled(true);
    if (!adminSessionToken) {
      const { sessionToken, user } = await authService.handleGoogleAuth({
        email: "admin-toggle-test-user@example.com",
        name: "Admin Toggle User",
      });
      const pool = getPool();
      await pool.query("UPDATE web_users SET role = 'admin' WHERE id = $1", [user.id]);
      adminSessionToken = sessionToken;
    }
  });

  it("should toggle execution engine dynamically via config functions", () => {
    expect(isExecutionEngineEnabled()).toBe(true);
    expect(getExecutionConfig().enabled).toBe(true);

    const toggledOff = toggleExecutionEngine();
    expect(toggledOff).toBe(false);
    expect(isExecutionEngineEnabled()).toBe(false);
    expect(getExecutionConfig().enabled).toBe(false);

    const toggledOn = toggleExecutionEngine();
    expect(toggledOn).toBe(true);
    expect(isExecutionEngineEnabled()).toBe(true);
    expect(getExecutionConfig().enabled).toBe(true);
  });

  it("POST /api/execution/toggle should toggle engine state and return updated status", async () => {
    setExecutionEngineEnabled(true);

    const res1 = await request(app)
      .post("/api/execution/toggle")
      .set("Authorization", `Bearer ${adminSessionToken}`);
    expect(res1.status).toBe(200);
    expect(res1.body.success).toBe(true);
    expect(res1.body.enabled).toBe(false);
    expect(isExecutionEngineEnabled()).toBe(false);

    const res2 = await request(app)
      .post("/api/execution/toggle")
      .set("Authorization", `Bearer ${adminSessionToken}`);
    expect(res2.status).toBe(200);
    expect(res2.body.success).toBe(true);
    expect(res2.body.enabled).toBe(true);
    expect(isExecutionEngineEnabled()).toBe(true);
  });

  it("POST /api/execution/set-enabled should explicitly set engine state", async () => {
    const resOff = await request(app)
      .post("/api/execution/set-enabled")
      .set("Authorization", `Bearer ${adminSessionToken}`)
      .send({ enabled: false });
    expect(resOff.status).toBe(200);
    expect(resOff.body.enabled).toBe(false);
    expect(isExecutionEngineEnabled()).toBe(false);

    const resOn = await request(app)
      .post("/api/execution/set-enabled")
      .set("Authorization", `Bearer ${adminSessionToken}`)
      .send({ enabled: true });
    expect(resOn.status).toBe(200);
    expect(resOn.body.enabled).toBe(true);
    expect(isExecutionEngineEnabled()).toBe(true);
  });

  it("GET /api/execution/health should reflect dynamic enabled state", async () => {
    setExecutionEngineEnabled(false);
    const resOff = await request(app)
      .get("/api/execution/health")
      .set("Authorization", `Bearer ${adminSessionToken}`);
    expect(resOff.status).toBe(200);
    expect(resOff.body.autonomousExecution.enabled).toBe(false);

    setExecutionEngineEnabled(true);
    const resOn = await request(app)
      .get("/api/execution/health")
      .set("Authorization", `Bearer ${adminSessionToken}`);
    expect(resOn.status).toBe(200);
    expect(resOn.body.autonomousExecution.enabled).toBe(true);
  });

  it("GET /api/execution/sessions should return sessions and current engine status", async () => {
    const res = await request(app)
      .get("/api/execution/sessions")
      .set("Authorization", `Bearer ${adminSessionToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.enabled).toBe("boolean");
    expect(Array.isArray(res.body.sessions)).toBe(true);
  });

  it("GET /api/stats should include executionEngine state in global telemetry", async () => {
    setExecutionEngineEnabled(true);
    const res = await request(app)
      .get("/api/stats")
      .set("Authorization", `Bearer ${adminSessionToken}`);
    expect(res.status).toBe(200);
    expect(res.body.executionEngine).toBeDefined();
    expect(res.body.executionEngine.enabled).toBe(true);
    expect(res.body.executionEngine.status).toBe("active");
  });
});
