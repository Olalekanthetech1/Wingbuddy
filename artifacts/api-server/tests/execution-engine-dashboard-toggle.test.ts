import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../src/app";
import {
  isExecutionEngineEnabled,
  setExecutionEngineEnabled,
  toggleExecutionEngine,
  getExecutionConfig,
} from "../src/execution/config";

describe("Execution Engine Dynamic Dashboard Toggle", () => {
  beforeEach(() => {
    setExecutionEngineEnabled(true);
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

    const res1 = await request(app).post("/api/execution/toggle");
    expect(res1.status).toBe(200);
    expect(res1.body.success).toBe(true);
    expect(res1.body.enabled).toBe(false);
    expect(isExecutionEngineEnabled()).toBe(false);

    const res2 = await request(app).post("/api/execution/toggle");
    expect(res2.status).toBe(200);
    expect(res2.body.success).toBe(true);
    expect(res2.body.enabled).toBe(true);
    expect(isExecutionEngineEnabled()).toBe(true);
  });

  it("POST /api/execution/set-enabled should explicitly set engine state", async () => {
    const resOff = await request(app)
      .post("/api/execution/set-enabled")
      .send({ enabled: false });
    expect(resOff.status).toBe(200);
    expect(resOff.body.enabled).toBe(false);
    expect(isExecutionEngineEnabled()).toBe(false);

    const resOn = await request(app)
      .post("/api/execution/set-enabled")
      .send({ enabled: true });
    expect(resOn.status).toBe(200);
    expect(resOn.body.enabled).toBe(true);
    expect(isExecutionEngineEnabled()).toBe(true);
  });

  it("GET /api/execution/health should reflect dynamic enabled state", async () => {
    setExecutionEngineEnabled(false);
    const resOff = await request(app).get("/api/execution/health");
    expect(resOff.status).toBe(200);
    expect(resOff.body.autonomousExecution.enabled).toBe(false);

    setExecutionEngineEnabled(true);
    const resOn = await request(app).get("/api/execution/health");
    expect(resOn.status).toBe(200);
    expect(resOn.body.autonomousExecution.enabled).toBe(true);
  });

  it("GET /api/execution/sessions should return sessions and current engine status", async () => {
    const res = await request(app).get("/api/execution/sessions");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.enabled).toBe("boolean");
    expect(Array.isArray(res.body.sessions)).toBe(true);
  });

  it("GET /api/stats should include executionEngine state in global telemetry", async () => {
    setExecutionEngineEnabled(true);
    const res = await request(app).get("/api/stats");
    expect(res.status).toBe(200);
    expect(res.body.executionEngine).toBeDefined();
    expect(res.body.executionEngine.enabled).toBe(true);
    expect(res.body.executionEngine.status).toBe("active");
  });
});
