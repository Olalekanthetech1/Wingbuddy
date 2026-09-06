import { describe, expect, it } from "vitest";
import { splitTelegramMessage } from "../src/utils/split-message";

describe("splitTelegramMessage", () => {
  it("returns short messages unchanged", () => {
    expect(splitTelegramMessage("Hello")).toEqual(["Hello"]);
  });

  it("splits long messages within Telegram's limit", () => {
    const parts = splitTelegramMessage(`${"alpha ".repeat(1500)}\n${"beta ".repeat(1500)}`);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 4096)).toBe(true);
    expect(parts.join(" ")).toContain("alpha");
    expect(parts.join(" ")).toContain("beta");
  });

  it("does not split an empty message into an empty chunk", () => {
    expect(splitTelegramMessage("   ")).toEqual([]);
  });
});