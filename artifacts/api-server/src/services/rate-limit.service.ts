import { AdaptiveEngineService } from "./adaptive-engine.service";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

interface Bucket {
  count: number;
  resetAt: number;
  allocatedMax: number;
}

export class RateLimitService {
  private readonly buckets = new Map<number, Bucket>();

  constructor(
    private readonly maxRequests?: number,
    private readonly windowMs?: number,
  ) {}

  async initializeDb(): Promise<void> {
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS rate_limits (
          user_id BIGINT PRIMARY KEY,
          count INTEGER NOT NULL,
          reset_at BIGINT NOT NULL,
          allocated_max INTEGER NOT NULL
        );
      `);
    } catch {
      // Memory fallback is used only when persistence is unavailable.
    }
  }

  consume(userId: number, now = Date.now()): boolean {
    const adaptive = AdaptiveEngineService.computeAdaptiveRateLimit();
    const effectiveMax = this.maxRequests ?? adaptive.maxRequests;
    const effectiveWindow = this.windowMs ?? adaptive.windowMs;
    const current = this.buckets.get(userId);

    if (!current || current.resetAt <= now) {
      this.buckets.set(userId, { count: 1, resetAt: now + effectiveWindow, allocatedMax: effectiveMax });
      return true;
    }

    if (current.count >= (this.maxRequests ?? current.allocatedMax)) return false;
    current.count += 1;
    return true;
  }

  async consumeAsync(userId: number, now = Date.now()): Promise<boolean> {
    try {
      const adaptive = AdaptiveEngineService.computeAdaptiveRateLimit();
      const effectiveMax = this.maxRequests ?? adaptive.maxRequests;
      const effectiveWindow = this.windowMs ?? adaptive.windowMs;
      const resetAtNew = now + effectiveWindow;

      const res = await db.execute(sql`
        INSERT INTO rate_limits (user_id, count, reset_at, allocated_max)
        VALUES (${userId}, 1, ${resetAtNew}, ${effectiveMax})
        ON CONFLICT (user_id) DO UPDATE SET
          count = CASE
                    WHEN rate_limits.reset_at <= ${now} THEN 1
                    ELSE rate_limits.count + 1
                  END,
          reset_at = CASE
                       WHEN rate_limits.reset_at <= ${now} THEN ${resetAtNew}
                       ELSE rate_limits.reset_at
                     END,
          allocated_max = ${effectiveMax}
        RETURNING count, reset_at, allocated_max;
      `);

      const row = res.rows[0] as { count: number; reset_at: number; allocated_max: number };
      const dynamicLimit = this.maxRequests ?? Math.max(Number(row.allocated_max), adaptive.maxRequests);

      this.buckets.set(userId, {
        count: Number(row.count),
        resetAt: Number(row.reset_at),
        allocatedMax: dynamicLimit,
      });

      return Number(row.count) <= dynamicLimit;
    } catch {
      return this.consume(userId, now);
    }
  }

  async getQuotaStatus(userId: number, now = Date.now()): Promise<{
    remaining: number;
    max: number;
    resetInMs: number;
  }> {
    const adaptive = AdaptiveEngineService.computeAdaptiveRateLimit();
    const effectiveMax = this.maxRequests ?? adaptive.maxRequests;

    try {
      const res = await db.execute(sql`SELECT count, reset_at, allocated_max FROM rate_limits WHERE user_id = ${userId} LIMIT 1`);
      if (res.rows.length > 0) {
        const row = res.rows[0] as { count: number; reset_at: number; allocated_max: number };
        const resetAt = Number(row.reset_at);
        const max = this.maxRequests ?? Math.max(Number(row.allocated_max), adaptive.maxRequests);
        if (resetAt <= now) return { remaining: max, max, resetInMs: 0 };
        const count = Number(row.count);
        this.buckets.set(userId, { count, resetAt, allocatedMax: max });
        return { remaining: Math.max(0, max - count), max, resetInMs: Math.max(0, resetAt - now) };
      }
    } catch {
      // Use the process-local mirror when DB reads are unavailable.
    }

    const current = this.buckets.get(userId);
    if (!current || current.resetAt <= now) return { remaining: effectiveMax, max: effectiveMax, resetInMs: 0 };
    const max = this.maxRequests ?? current.allocatedMax;
    return { remaining: Math.max(0, max - current.count), max, resetInMs: Math.max(0, current.resetAt - now) };
  }

  async clear(userId: number): Promise<void> {
    this.buckets.delete(userId);
    try {
      await db.execute(sql`DELETE FROM rate_limits WHERE user_id = ${userId}`);
    } catch {
      // Ignore persistence errors during cleanup.
    }
  }
}
