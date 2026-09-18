import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Signed no-login link for the CLIENT'S COUNSEL to read one negotiated
 * agreement (/agreement/review/<token>).
 *
 * Wes, 2026-09-18: "Ideally, I can just send it in HQ to him, and he can
 * review it there with a button that allows him to download a DOCX file."
 *
 * Same HMAC-SHA256 envelope as coiUploadToken.ts and brokerReviewToken.ts —
 * base64url(payload).base64url(hmac) over NEXTAUTH_SECRET with an `exp` —
 * and the same two deliberate properties:
 *
 *  1. A DOMAIN SEPARATOR ("counsel-review.v1") is inside the signed
 *     material. Three schemes now sign JSON with one secret; without the
 *     prefix a payload satisfying another reader's shape would verify, so a
 *     COI upload link could be replayed as a contract link or vice versa.
 *  2. The payload is ONE agreement (`companyAgreementId`). Counsel forwards
 *     links to their own colleagues as a matter of course; a forwarded link
 *     must not widen to another client's terms.
 *
 * The token IS the credential — opposing counsel has no login and never
 * will. Which is why the page is read-only in the strong sense (no form, no
 * POST, no session) and carries nothing but their own agreement and the two
 * download buttons. Anyone they forward it to sees what their own client
 * could already have sent them.
 */

const COUNSEL_LINK_TTL_MS = 45 * 24 * 3_600_000 // 45 days — same as the broker's
const DOMAIN = 'counsel-review.v1'

export interface CounselReviewTokenPayload {
  /** The CompanyAgreement this link reviews. */
  companyAgreementId: string
  exp: number
}

function getSecret(): string {
  const s = process.env.NEXTAUTH_SECRET || process.env.PORTAL_SESSION_SECRET
  if (!s) throw new Error('NEXTAUTH_SECRET not set — cannot sign counsel review tokens')
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

export function signCounselReviewToken(
  p: Omit<CounselReviewTokenPayload, 'exp'>,
  ttlMs: number = COUNSEL_LINK_TTL_MS,
): string {
  if (!p.companyAgreementId) throw new Error('companyAgreementId is required to sign a counsel review token')
  const payload: CounselReviewTokenPayload = {
    companyAgreementId: p.companyAgreementId,
    exp: Date.now() + ttlMs,
  }
  const head = base64url(JSON.stringify(payload))
  return `${head}.${base64url(mac(head))}`
}

export function verifyCounselReviewToken(token: string | undefined | null): CounselReviewTokenPayload | null {
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
  let payload: CounselReviewTokenPayload
  try {
    payload = JSON.parse(fromBase64url(head).toString('utf-8'))
  } catch {
    return null
  }
  if (typeof payload.companyAgreementId !== 'string' || !payload.companyAgreementId) return null
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
  return payload
}

/** Absolute URL for the link. Absolute because it goes in an email. */
export function counselReviewUrl(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    'https://hq.sirreel.com'
  return `${base.replace(/\/+$/, '')}/agreement/review/${token}`
}
