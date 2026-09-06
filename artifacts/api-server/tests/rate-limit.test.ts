import { describe, expect, it } from "vitest";
import { RateLimitService } from "../src/services/rate-limit.service";

describe("RateLimitService", () => {
  it("limits each user independently and resets after the window", () => {
    const limiter = new RateLimitService(2, 1000);
    expect(limiter.consume(1, 100)).toBe(true);
    expect(limiter.consume(1, 200)).toBe(true);
    expect(limiter.consume(1, 300)).toBe(false);
    expect(limiter.consume(2, 300)).toBe(true);
    expect(limiter.consume(1, 1100)).toBe(true);
  });
});