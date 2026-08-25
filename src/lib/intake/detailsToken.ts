import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Signed no-login link tokens for the client-facing "tell us your company
 * and project" surface (/details/<token>).
 *
 * Same HMAC-SHA256 envelope as src/lib/coi/coiUploadToken.ts —
 * base64url(payload).base64url(hmac) signed with NEXTAUTH_SECRET, with an
 * `exp`. No new auth scheme; the client clicks the link, no login.
 *
 * Why a link at all (Wes, 2026-08-25): the Quick Reply email asks "what's
 * the production company and project name? Just reply with those." Email
 * cannot carry working input fields — Gmail strips <form> outright,
 * Outlook's Word renderer never supported them, and shipping one raises
 * the spam score — so the nearest thing is one tap to a page with the two
 * fields on it. The reply then arrives structured instead of as prose
 * somebody has to read and re-key.
 *
 * `ask` records WHICH fields we were missing when the mail went out, so
 * the page asks for exactly those and never re-asks for a company we
 * already knew.
 *
 * `sentTo` is the address we mailed. It is carried in the SIGNED payload
 * and stamped on the reply server-side, so the form itself can never claim
 * the answer came from someone else.
 */

const DETAILS_LINK_TTL_MS = 30 * 24 * 3_600_000 // 30 days — a quote cycle

export interface DetailsTokenPayload {
  /** Usually set: the ask fires when no company is known, and a soft hold
   *  needs one, so there is normally no Booking yet. */
  inquiryId?: string
  /** Set for the narrower case — holds exist, the job is still unnamed. */
  bookingId?: string
  sentTo?: string
  ask: { company: boolean; project: boolean }
  exp: number
}

function getSecret(): string {
  const s = process.env.NEXTAUTH_SECRET || process.env.PORTAL_SESSION_SECRET
  if (!s) throw new Error('NEXTAUTH_SECRET not set — cannot sign details link tokens')
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

export function signDetailsToken(
  p: Omit<DetailsTokenPayload, 'exp'>,
  ttlMs: number = DETAILS_LINK_TTL_MS,
): string {
  const payload: DetailsTokenPayload = { ...p, exp: Date.now() + ttlMs }
  const head = base64url(JSON.stringify(payload))
  const mac = createHmac('sha256', getSecret()).update(head).digest()
  return `${head}.${base64url(mac)}`
}

export function verifyDetailsToken(token: string | undefined | null): DetailsTokenPayload | null {
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
  let payload: DetailsTokenPayload
  try {
    payload = JSON.parse(fromBase64url(head).toString('utf-8'))
  } catch {
    return null
  }
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
  if (!payload.ask || typeof payload.ask !== 'object') return null
  if (!payload.inquiryId && !payload.bookingId) return null
  return payload
}

/** Absolute URL for the client-facing page. */
export function detailsLinkUrl(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    'https://hq.sirreel.com'
  return `${base.replace(/\/+$/, '')}/details/${token}`
}
