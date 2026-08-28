/**
 * Signed unsubscribe links.
 *
 * The link in an outreach email must be safe to hand a stranger: it goes
 * to a public, unauthenticated endpoint, and it identifies a person.
 *
 * ── Why HMAC and not a stored token ────────────────────────────────
 * Stateless. There is no row to create at send time, nothing to clean
 * up, and a link keeps working forever — which matters, because people
 * unsubscribe from mail they find eighteen months later. A stored token
 * would either expire (and silently stop honouring opt-outs, the worst
 * possible failure here) or accumulate a row per recipient per send.
 *
 * ── Why the email is in the payload ────────────────────────────────
 * Suppression is keyed on address, not on Person, so the address is the
 * subject. It is base64url-encoded in the link and re-derived on the
 * other side; the signature is what makes it trustworthy. An attacker
 * can read an address out of a link they already possess — which they
 * do, since it was mailed to them — but cannot mint a link for anyone
 * else's address without the secret.
 *
 * ── Deliberately NOT expiring ──────────────────────────────────────
 * There is no timestamp in the signature. An unsubscribe link that stops
 * working is a compliance failure wearing a security costume.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Secret for signing. Falls back to NEXTAUTH_SECRET so the feature works
 * before a dedicated secret is provisioned — both are already required,
 * server-only values.
 */
function signingSecret(): string {
  const secret = process.env.OUTREACH_UNSUBSCRIBE_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) {
    throw new Error(
      'No OUTREACH_UNSUBSCRIBE_SECRET or NEXTAUTH_SECRET set — refusing to mint an unsignable unsubscribe link.',
    )
  }
  return secret
}

const b64url = (buf: Buffer) => buf.toString('base64url')

function sign(payload: string): string {
  return b64url(createHmac('sha256', signingSecret()).update(payload).digest())
}

export interface UnsubscribeLinkParts {
  /** base64url of the normalized email — the `e` query param. */
  e: string
  /** HMAC signature — the `t` query param. */
  t: string
}

export function mintUnsubscribeParts(email: string): UnsubscribeLinkParts {
  const normalized = email.trim().toLowerCase()
  const e = b64url(Buffer.from(normalized, 'utf8'))
  return { e, t: sign(e) }
}

/**
 * Verify and return the address, or null.
 *
 * Comparison is timing-safe. The lengths are checked first because
 * timingSafeEqual throws on a length mismatch, and a thrown error is
 * itself a timing signal.
 */
export function verifyUnsubscribeToken(e: string | null, t: string | null): string | null {
  if (!e || !t) return null
  let expected: string
  try {
    expected = sign(e)
  } catch {
    return null
  }
  const a = Buffer.from(t)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null
  if (!timingSafeEqual(a, b)) return null
  try {
    const email = Buffer.from(e, 'base64url').toString('utf8').trim().toLowerCase()
    // Cheap sanity check — a signature over garbage is still a valid
    // signature, and we do not want to suppress a non-address.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null
    return email
  } catch {
    return null
  }
}
