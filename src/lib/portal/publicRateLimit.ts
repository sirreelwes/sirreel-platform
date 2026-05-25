/**
 * Per-IP rate limiter for public unauthenticated endpoints.
 *
 * In-memory sliding window. Not durable across restarts and not
 * shared across instances — fine for V1 (single Vercel function
 * per region warming up will reset its window). When abuse becomes
 * visible we can upgrade to a Redis-backed implementation behind
 * this same interface.
 *
 * Default policy: 5 requests per 10 minutes per IP. Caller can
 * override via the policy arg.
 */

const buckets = new Map<string, number[]>()

export interface RateLimitPolicy {
  windowMs: number
  max: number
}

const DEFAULT_POLICY: RateLimitPolicy = { windowMs: 10 * 60_000, max: 5 }

export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfterSeconds: number
}

export function checkRateLimit(key: string, policy: RateLimitPolicy = DEFAULT_POLICY): RateLimitResult {
  const now = Date.now()
  const cutoff = now - policy.windowMs
  const arr = buckets.get(key) ?? []
  // Drop hits outside the window.
  const fresh = arr.filter((t) => t > cutoff)
  if (fresh.length >= policy.max) {
    const oldest = fresh[0]
    const retryAfterSeconds = Math.ceil((oldest + policy.windowMs - now) / 1000)
    buckets.set(key, fresh)
    return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, retryAfterSeconds) }
  }
  fresh.push(now)
  buckets.set(key, fresh)
  return { ok: true, remaining: policy.max - fresh.length, retryAfterSeconds: 0 }
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]!.trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}
