import { AdaptiveEngineService } from "./adaptive-engine.service";

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

  /**
   * Consumes a rate limit token using dynamic, adaptive capacity.
   * If custom limits were not explicitly pinned, capacity dynamically scales
   * with the number of healthy keys in the pool and key health status.
   */
  consume(userId: number, now = Date.now()): boolean {
    const adaptive = AdaptiveEngineService.computeAdaptiveRateLimit();
    const effectiveMax = this.maxRequests ?? adaptive.maxRequests;
    const effectiveWindow = this.windowMs ?? adaptive.windowMs;

    const current = this.buckets.get(userId);
    if (!current || current.resetAt <= now) {
      this.buckets.set(userId, {
        count: 1,
        resetAt: now + effectiveWindow,
        allocatedMax: effectiveMax,
      });
      return true;
    }

    // Dynamic adjustment: if key pool expanded or contracted mid-window, use current adaptive max
    const dynamicLimit = this.maxRequests ?? Math.max(current.allocatedMax, adaptive.maxRequests);

    if (current.count >= dynamicLimit) return false;
    current.count += 1;
    return true;
  }

  getQuotaStatus(userId: number, now = Date.now()): {
    remaining: number;
    max: number;
    resetInMs: number;
  } {
    const adaptive = AdaptiveEngineService.computeAdaptiveRateLimit();
    const effectiveMax = this.maxRequests ?? adaptive.maxRequests;
    const effectiveWindow = this.windowMs ?? adaptive.windowMs;

    const current = this.buckets.get(userId);
    if (!current || current.resetAt <= now) {
      return { remaining: effectiveMax, max: effectiveMax, resetInMs: 0 };
    }

    const remaining = Math.max(0, effectiveMax - current.count);
    const resetInMs = Math.max(0, current.resetAt - now);
    return { remaining, max: effectiveMax, resetInMs };
  }

  clear(userId: number): void {
    this.buckets.delete(userId);
  }
}
