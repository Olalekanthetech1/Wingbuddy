import { describe, expect, it } from "vitest";
import request from "supertest";

describe("health endpoint", () => {
  it("returns a non-sensitive healthy response", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.GEMINI_API_KEY = "test-key";
    const { default: app } = await import("../src/app");
    const response = await request(app).get("/api/healthz");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  }, 15000);
});