interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimitService {
  private readonly buckets = new Map<number, Bucket>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  consume(userId: number, now = Date.now()): boolean {
    const current = this.buckets.get(userId);
    if (!current || current.resetAt <= now) {
      this.buckets.set(userId, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (current.count >= this.maxRequests) return false;
    current.count += 1;
    return true;
  }

  clear(userId: number): void {
    this.buckets.delete(userId);
  }
}