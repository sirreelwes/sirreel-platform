import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Signed-payload tokens for the multi-contact authorization flow (CRH §5).
 * Same HMAC-SHA256 envelope as jobSession.ts, but payload carries the
 * "ask Lisa to authorize Sarah" decision data so the approve/decline links
 * can be clicked from email without a separate session.
 *
 * Token format: base64url(payload).base64url(hmac)
 * Payload: { orderId, requesterContactId, newEmail, newFirstName?, newLastName?, exp }
 */

const AUTHORIZE_TTL_MS = 14 * 24 * 3_600_000 // 14 days

export interface AuthorizePayload {
  orderId: string
  requesterContactId: string
  newEmail: string
  newFirstName?: string
  newLastName?: string
  exp: number
}

function getSecret(): string {
  const s = process.env.NEXTAUTH_SECRET || process.env.PORTAL_SESSION_SECRET
  if (!s) throw new Error('NEXTAUTH_SECRET not set — cannot sign authorize tokens')
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

export function signAuthorizeToken(p: Omit<AuthorizePayload, 'exp'>, ttlMs: number = AUTHORIZE_TTL_MS): string {
  const payload: AuthorizePayload = { ...p, exp: Date.now() + ttlMs }
  const head = base64url(JSON.stringify(payload))
  const mac = createHmac('sha256', getSecret()).update(head).digest()
  return `${head}.${base64url(mac)}`
}

export function verifyAuthorizeToken(token: string | undefined | null): AuthorizePayload | null {
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
  let payload: AuthorizePayload
  try {
    payload = JSON.parse(fromBase64url(head).toString('utf-8'))
  } catch {
    return null
  }
  if (typeof payload.orderId !== 'string' || typeof payload.requesterContactId !== 'string' || typeof payload.newEmail !== 'string') {
    return null
  }
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
  return payload
}
