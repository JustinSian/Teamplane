export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfterMs: number
}

interface Bucket {
  tokens: number
  updatedAt: number
}

/**
 * A per-principal token bucket. Deliberately small and synchronous: the server
 * is single-threaded, and a rate limit is not a security boundary — it is a
 * courtesy that keeps one runaway agent from starving the console.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>()
  private readonly capacity: number
  private readonly refillPerSecond: number
  private readonly now: () => number

  constructor(options: { capacity?: number; refillPerSecond?: number; now?: () => number } = {}) {
    this.capacity = Math.max(1, options.capacity ?? 120)
    this.refillPerSecond = Math.max(0, options.refillPerSecond ?? 2)
    this.now = options.now ?? Date.now
  }

  take(key: string, cost = 1): RateLimitResult {
    const now = this.now()
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now }
    const elapsed = Math.max(0, now - bucket.updatedAt) / 1000
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerSecond)
    bucket.updatedAt = now

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost
      this.buckets.set(key, bucket)
      return { ok: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 }
    }

    this.buckets.set(key, bucket)
    const missing = cost - bucket.tokens
    const retryAfterMs = this.refillPerSecond === 0 ? 60_000 : Math.ceil((missing / this.refillPerSecond) * 1000)
    return { ok: false, remaining: Math.floor(bucket.tokens), retryAfterMs }
  }

  /** Drop idle buckets so a long-running server does not grow without bound. */
  prune(idleMs = 60 * 60 * 1000): void {
    const cutoff = this.now() - idleMs
    for (const [key, bucket] of this.buckets) {
      if (bucket.updatedAt < cutoff) this.buckets.delete(key)
    }
  }

  size(): number {
    return this.buckets.size
  }
}

export function rateLimiterFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimiter {
  const rawCapacity = env.TEAMPLANE_RATE_BURST
  const rawRefill = env.TEAMPLANE_RATE_PER_SECOND
  const capacity = rawCapacity === undefined || rawCapacity === '' ? NaN : Number(rawCapacity)
  const refill = rawRefill === undefined || rawRefill === '' ? NaN : Number(rawRefill)
  return new RateLimiter({
    capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : 120,
    refillPerSecond: Number.isFinite(refill) && refill >= 0 ? refill : 2,
  })
}
