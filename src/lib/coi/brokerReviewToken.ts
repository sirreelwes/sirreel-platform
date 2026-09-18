import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Signed no-login link tokens for the BROKER's read-only review of one
 * certificate (/coi/broker/<token>).
 *
 * Same HMAC-SHA256 envelope as src/lib/coi/coiUploadToken.ts —
 * base64url(payload).base64url(hmac), signed with NEXTAUTH_SECRET, with an
 * `exp` — with two deliberate differences:
 *
 *  1. A DOMAIN SEPARATOR ("coi-broker-review.v1") goes into the signed
 *     material, so an upload token can never be replayed as a review token
 *     and vice versa. Both schemes sign a JSON blob with the same secret;
 *     without the prefix, a payload that happens to satisfy the other
 *     reader's shape would verify.
 *  2. The payload is ONE certificate (`coiId`). The upload link is a drop
 *     box scoped to a job or a company; this one exposes a specific
 *     document's findings and must not widen when it is forwarded.
 *
 * The token IS the credential — the broker has no login and never will. That
 * is why the page it opens is read-only and carries nothing but the
 * requirements, what the certificate shows, and who to send a corrected one
 * to. Anyone the broker forwards it to sees exactly what the broker's own
 * customer could already tell them.
 */

const BROKER_LINK_TTL_MS = 45 * 24 * 3_600_000 // 45 days — a correction round trip is days, not months
const DOMAIN = 'coi-broker-review.v1'

export interface CoiBrokerTokenPayload {
  /** The CoiCheck this link reviews. */
  coiId: string
  exp: number
}

function getSecret(): string {
  const s = process.env.NEXTAUTH_SECRET || process.env.PORTAL_SESSION_SECRET
  if (!s) throw new Error('NEXTAUTH_SECRET not set — cannot sign COI broker review tokens')
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

function mac(head: string): Buffer {
  return createHmac('sha256', getSecret()).update(`${DOMAIN}.${head}`).digest()
}

export function signCoiBrokerToken(
  p: Omit<CoiBrokerTokenPayload, 'exp'>,
  ttlMs: number = BROKER_LINK_TTL_MS,
): string {
  if (!p.coiId) throw new Error('coiId is required to sign a broker review token')
  const payload: CoiBrokerTokenPayload = { coiId: p.coiId, exp: Date.now() + ttlMs }
  const head = base64url(JSON.stringify(payload))
  return `${head}.${base64url(mac(head))}`
}

export function verifyCoiBrokerToken(token: string | undefined | null): CoiBrokerTokenPayload | null {
  if (!token || typeof token !== 'string') return null
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null
  const head = token.slice(0, dot)
  let expected: Buffer
  try {
    expected = mac(head)
  } catch {
    return null
  }
  let received: Buffer
  try {
    received = fromBase64url(token.slice(dot + 1))
  } catch {
    return null
  }
  if (expected.length !== received.length) return null
  if (!timingSafeEqual(expected, received)) return null
  let payload: CoiBrokerTokenPayload
  try {
    payload = JSON.parse(fromBase64url(head).toString('utf-8'))
  } catch {
    return null
  }
  if (typeof payload.coiId !== 'string' || !payload.coiId) return null
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
  return payload
}
