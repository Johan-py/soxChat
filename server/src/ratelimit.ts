/**
 * Simple in-memory sliding-window rate limiter.
 *
 * Security: prevents abuse (room creation spam, WS connection floods).
 * Note: in a multi-instance deployment, replace with Redis-backed limiter.
 */

interface Bucket {
  timestamps: number[];
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private max: number;
  private windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /** Returns true if the request is allowed, false if rate-limited. */
  isAllowed(key: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.buckets.set(key, bucket);
    }

    // Remove timestamps outside the window
    bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);

    if (bucket.timestamps.length >= this.max) {
      return false;
    }

    bucket.timestamps.push(now);
    return true;
  }

  /** Periodic cleanup to prevent memory leaks. */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    for (const [key, bucket] of this.buckets) {
      bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);
      if (bucket.timestamps.length === 0) {
        this.buckets.delete(key);
      }
    }
  }
}
