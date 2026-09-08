import type { Redis } from "ioredis";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/** Fixed-window counter shared by every API instance, so a client can't spread attempts across processes. */
export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "tracklane:ratelimit",
  ) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const redisKey = `${this.prefix}:${key}`;
    const result = await this.redis.multi().incr(redisKey).pexpire(redisKey, windowMs, "NX").pttl(redisKey).exec();
    const count = Number(result?.[0]?.[1] ?? 0);
    const ttl = Number(result?.[2]?.[1] ?? windowMs);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterMs: ttl > 0 ? ttl : windowMs };
  }
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    await Promise.resolve();
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    if (this.windows.size > 10_000) this.evictExpired(now);
    return { allowed: window.count <= limit, remaining: Math.max(0, limit - window.count), retryAfterMs: window.resetAt - now };
  }

  private evictExpired(now: number): void {
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key);
  }
}

/**
 * Per-connection token bucket for socket events. It lives in process memory
 * because a socket is pinned to one instance for its whole life.
 */
export class TokenBucket {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.updatedAt = now();
  }

  take(cost = 1): boolean {
    const now = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.updatedAt) / 1_000) * this.refillPerSecond);
    this.updatedAt = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
