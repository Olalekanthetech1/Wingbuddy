import { describe, expect, it } from "vitest";
import { isAuthorizedTelegramUser } from "../src/services/authorization.service";

describe("Telegram authorization", () => {
  it("allows everyone when the allowlist is empty", () => {
    expect(isAuthorizedTelegramUser(123, new Set())).toBe(true);
  });

  it("only allows configured user IDs", () => {
    expect(isAuthorizedTelegramUser(123, new Set([123]))).toBe(true);
    expect(isAuthorizedTelegramUser(456, new Set([123]))).toBe(false);
  });
});