import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Signed no-login link tokens for the client-facing COI upload surface
 * (/coi/<token>). Reuses the SAME HMAC-SHA256 envelope as
 * src/lib/portal/authorizeToken.ts + jobSession.ts — base64url(payload)
 * .base64url(hmac), signed with NEXTAUTH_SECRET, with an `exp`. No new
 * auth scheme; clients click the link, no login.
 *
 * The payload carries whichever context the team has when they share the
 * link — a job, a company, an inquiry, or none (a generic drop that lands
 * UNATTACHED). All optional on purpose: COIs often arrive while quoting,
 * before a job (or even a company) exists.
 */

const COI_LINK_TTL_MS = 60 * 24 * 3_600_000 // 60 days — COIs trickle in slowly

export interface CoiTokenPayload {
  jobId?: string
  companyId?: string
  inquiryId?: string
  exp: number
}

function getSecret(): string {
  const s = process.env.NEXTAUTH_SECRET || process.env.PORTAL_SESSION_SECRET
  if (!s) throw new Error('NEXTAUTH_SECRET not set — cannot sign COI link tokens')
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

export function signCoiToken(
  p: Omit<CoiTokenPayload, 'exp'>,
  ttlMs: number = COI_LINK_TTL_MS,
): string {
  const payload: CoiTokenPayload = { ...p, exp: Date.now() + ttlMs }
  const head = base64url(JSON.stringify(payload))
  const mac = createHmac('sha256', getSecret()).update(head).digest()
  return `${head}.${base64url(mac)}`
}

export function verifyCoiToken(token: string | undefined | null): CoiTokenPayload | null {
  if (!token || typeof token !== 'string') return null
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null
  const head = token.slice(0, dot)
  const macIn = token.slice(dot + 1)
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
  let payload: CoiTokenPayload
  try {
    payload = JSON.parse(fromBase64url(head).toString('utf-8'))
  } catch {
    return null
  }
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
  return payload
}
