import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MODEL, getConfig } from "../src/config/env";

describe("environment validation", () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.GEMINI_API_KEY = "test-key";
    delete process.env.TELEGRAM_WEBHOOK_URL;
    delete process.env.ALLOWED_TELEGRAM_USER_IDS;
    delete process.env.GEMINI_MODEL;
  });

  it("uses the dynamic default when no model is configured", () => {
    expect(getConfig().geminiModel).toBe(DEFAULT_MODEL);
  });

  it("dynamically resolves custom GEMINI_MODEL when configured", () => {
    process.env.GEMINI_MODEL = "gemini-2.5-flash";
    expect(getConfig().geminiModel).toBe("gemini-2.5-flash");
  });

  it("requires the bot token", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(() => getConfig()).toThrow("TELEGRAM_BOT_TOKEN is required");
  });

  it("parses configurable values and the allowlist", () => {
    process.env.GEMINI_MODEL = "gemini-test";
    process.env.ALLOWED_TELEGRAM_USER_IDS = "123, 456";
    expect(getConfig()).toMatchObject({
      geminiModel: "gemini-test",
      allowedTelegramUserIds: new Set([123, 456]),
      usePolling: true,
    });
  });
});