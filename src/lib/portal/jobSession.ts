import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

/**
 * Signed-cookie session for the CRH Job Page portal. Cookie format:
 *
 *   <base64url(payload)>.<base64url(hmac-sha256(payload, secret))>
 *
 * where payload is JSON `{ portalAccessId, exp }`. exp is a unix-ms timestamp.
 *
 * Why HMAC over JWT lib: we need exactly one claim, one signing key, and a
 * single revocation check on read — the next-auth/jose machinery is more
 * than the use case needs. Both sign and verify use timingSafeEqual to
 * dodge timing oracles.
 *
 * Revocation: even a valid signature passes through to the caller, which
 * MUST re-check PortalAccess.revokedAt before honoring the session. The
 * cookie alone is not authorization.
 */

const SESSION_TTL_MS = 30 * 24 * 3_600_000 // 30 days, per CRH brief §13

interface SessionPayload {
  portalAccessId: string
  exp: number // unix ms
}

function getSecret(): string {
  const s = process.env.NEXTAUTH_SECRET || process.env.PORTAL_SESSION_SECRET
  if (!s) {
    throw new Error('NEXTAUTH_SECRET (or PORTAL_SESSION_SECRET) not set — cannot sign portal sessions')
  }
  return s
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64url(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=')
  return Buffer.from(padded, 'base64')
}

function sign(payload: SessionPayload): string {
  const json = JSON.stringify(payload)
  const head = base64url(json)
  const mac = createHmac('sha256', getSecret()).update(head).digest()
  return `${head}.${base64url(mac)}`
}

export function createJobSessionCookieValue(portalAccessId: string, ttlMs: number = SESSION_TTL_MS): string {
  return sign({ portalAccessId, exp: Date.now() + ttlMs })
}

export function verifyJobSessionCookieValue(cookie: string | undefined | null): { portalAccessId: string } | null {
  if (!cookie || typeof cookie !== 'string') return null
  const dot = cookie.indexOf('.')
  if (dot <= 0 || dot === cookie.length - 1) return null
  const head = cookie.slice(0, dot)
  const macIn = cookie.slice(dot + 1)

  let expected: Buffer
  try {
    expected = createHmac('sha256', getSecret()).update(head).digest()
  } catch {
    return null
  }
  let received: Buffer
  try {
    received = fromBase64url(macIn)
  } catch {
    return null
  }
  if (expected.length !== received.length) return null
  if (!timingSafeEqual(expected, received)) return null

  let payload: SessionPayload
  try {
    payload = JSON.parse(fromBase64url(head).toString('utf-8'))
  } catch {
    return null
  }
  if (typeof payload.portalAccessId !== 'string' || typeof payload.exp !== 'number') return null
  if (payload.exp < Date.now()) return null
  return { portalAccessId: payload.portalAccessId }
}

export const JOB_SESSION_COOKIE = 'sr_portal_session'

export function buildJobSessionCookieHeader(value: string, opts: { maxAgeMs?: number; clear?: boolean } = {}): string {
  if (opts.clear) {
    return `${JOB_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  }
  const maxAge = Math.floor((opts.maxAgeMs ?? SESSION_TTL_MS) / 1000)
  return `${JOB_SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}

/** Random hex token for magic-link issuance (32 bytes = 256 bits). */
export function generateMagicLinkToken(): string {
  return randomBytes(32).toString('hex')
}
