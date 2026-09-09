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

  async initializeDb() {
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
      // Fallback gracefully to memory if db unavailable
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

    if (current.count >= (this.maxRequests ?? current.allocatedMax)) {
      return false;
    }

    current.count += 1;
    return true;
  }

  /**
   * Consumes a rate limit token using dynamic, adaptive capacity.
   */
  async consumeAsync(userId: number, now = Date.now()): Promise<boolean> {
    try {
      const adaptive = AdaptiveEngineService.computeAdaptiveRateLimit();
      const effectiveMax = this.maxRequests ?? adaptive.maxRequests;
      const effectiveWindow = this.windowMs ?? adaptive.windowMs;
      const resetAtNew = now + effectiveWindow;

      // Atomic upsert with Postgres
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

      const row = res.rows[0];
      const dynamicLimit = this.maxRequests ?? Math.max(row.allocated_max, adaptive.maxRequests);

      if (row.count > dynamicLimit) {
        return false; // Rate limited
      }
      return true;
    } catch {
      return this.consume(userId, now);
    }
  }

  getQuotaStatus(userId: number, now = Date.now()): {
    remaining: number;
    max: number;
    resetInMs: number;
  } {
    const adaptive = AdaptiveEngineService.computeAdaptiveRateLimit();
    const effectiveMax = this.maxRequests ?? adaptive.maxRequests;
    const current = this.buckets.get(userId);
    if (!current || current.resetAt <= now) {
      return { remaining: effectiveMax, max: effectiveMax, resetInMs: 0 };
    }
    const max = this.maxRequests ?? current.allocatedMax;
    const remaining = Math.max(0, max - current.count);
    const resetInMs = Math.max(0, current.resetAt - now);
    return { remaining, max, resetInMs };
  }

  async clear(userId: number): Promise<void> {
    this.buckets.delete(userId);
    try {
      await db.execute(sql`DELETE FROM rate_limits WHERE user_id = ${userId}`);
    } catch {
      // Ignore db error
    }
  }
}
