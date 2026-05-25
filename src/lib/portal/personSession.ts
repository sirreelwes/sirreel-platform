import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

/**
 * Signed-cookie session for the person-scoped client portal. Cookie
 * format mirrors src/lib/portal/jobSession.ts:
 *
 *   <base64url(payload)>.<base64url(hmac-sha256(payload, secret))>
 *
 * where payload is JSON `{ personSessionId, exp }`. exp is unix-ms.
 *
 * Why a separate file (vs reusing jobSession): the cookie carries a
 * different claim (personSessionId vs portalAccessId), the cookie
 * NAME is different (sr_person_session vs sr_portal_session) so the
 * two systems don't overwrite each other, and we want each surface's
 * tokens to be revoked independently.
 *
 * Revocation: even a valid signature passes through to the caller —
 * always re-check PersonSession.revokedAt before honoring the
 * session. The cookie alone is NOT authorization.
 */

const SESSION_TTL_MS = 30 * 24 * 3_600_000 // 30 days
export const PERSON_MAGIC_LINK_TTL_MS = 30 * 60_000 // 30 minutes
export const PERSON_SESSION_COOKIE = 'sr_person_session'

interface SessionPayload {
  personSessionId: string
  exp: number
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

export function createPersonSessionCookieValue(
  personSessionId: string,
  ttlMs: number = SESSION_TTL_MS,
): string {
  return sign({ personSessionId, exp: Date.now() + ttlMs })
}

export function verifyPersonSessionCookieValue(
  cookie: string | undefined | null,
): { personSessionId: string } | null {
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
  if (typeof payload.personSessionId !== 'string' || typeof payload.exp !== 'number') return null
  if (payload.exp < Date.now()) return null
  return { personSessionId: payload.personSessionId }
}

export function buildPersonSessionCookieHeader(
  value: string,
  opts: { maxAgeMs?: number; clear?: boolean } = {},
): string {
  if (opts.clear) {
    return `${PERSON_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  }
  const maxAge = Math.floor((opts.maxAgeMs ?? SESSION_TTL_MS) / 1000)
  return `${PERSON_SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}

/** Random hex token for magic-link issuance (32 bytes = 256 bits). */
export function generatePersonMagicLinkToken(): string {
  return randomBytes(32).toString('hex')
}
