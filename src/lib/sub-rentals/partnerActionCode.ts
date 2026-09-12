/**
 * A short code, emailed to the address ALREADY on file, for the one thing a
 * partner-page link must not let a stranger do quietly: move where SirReel's
 * mail goes.
 *
 * Wes 2026-09-11, asked whether the link being the credential is a danger:
 * "Is this a danger, a loop we should close?" The link is 32 random bytes and
 * unguessable, but it is forwardable — and since the contacts section shipped,
 * a holder could make themselves the main contact, or add themselves to
 * booking mail, and start receiving the partner's post. This closes that:
 * changing where mail goes needs a code that only reaches the address on file.
 *
 * STATELESS, like every other no-login credential here (portal/authorizeToken,
 * coi/coiUploadToken): HMAC-SHA256 over vendor + purpose + a 10-minute window,
 * signed with NEXTAUTH_SECRET. No table, no cleanup, nothing to leak. The
 * previous window is also accepted, so a code lives 10–20 minutes.
 *
 * It is a SECOND factor on one action, not an identity: it proves the person
 * asking can read the partner's existing inbox. Everything else on the page
 * stays one click, as it should.
 */
import { createHmac, timingSafeEqual } from 'crypto'

const WINDOW_MS = 10 * 60_000
/** A code is valid for its own window and the one before it. */
export const PARTNER_CODE_TTL_MINUTES = 20

/** The only thing a code is minted for today. */
export type PartnerActionPurpose = 'mail-routing'

function getSecret(): string {
  const s = process.env.NEXTAUTH_SECRET || process.env.PORTAL_SESSION_SECRET
  if (!s) throw new Error('NEXTAUTH_SECRET not set — cannot sign partner action codes')
  return s
}

function codeFor(vendorId: string, purpose: PartnerActionPurpose, window: number): string {
  const mac = createHmac('sha256', getSecret()).update(`${vendorId}:${purpose}:${window}`).digest()
  // Six digits from the first 4 bytes — leading zeros kept, so every code is 6 long.
  return String(mac.readUInt32BE(0) % 1_000_000).padStart(6, '0')
}

/** The code to email them now. */
export function partnerActionCode(vendorId: string, purpose: PartnerActionPurpose, now = Date.now()): string {
  return codeFor(vendorId, purpose, Math.floor(now / WINDOW_MS))
}

/** True when `code` is this partner's current (or previous) code. */
export function verifyPartnerActionCode(
  vendorId: string,
  purpose: PartnerActionPurpose,
  code: unknown,
  now = Date.now(),
): boolean {
  if (typeof code !== 'string') return false
  const given = code.replace(/\D/g, '')
  if (given.length !== 6) return false
  const win = Math.floor(now / WINDOW_MS)
  const buf = Buffer.from(given)
  for (const w of [win, win - 1]) {
    const expected = Buffer.from(codeFor(vendorId, purpose, w))
    if (expected.length === buf.length && timingSafeEqual(expected, buf)) return true
  }
  return false
}

/** vic@vsmplanetrentals.com → v••@vsmplanetrentals.com — enough to know which
 *  inbox to open, not enough to learn an address you didn't know. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '•••'
  const name = email.slice(0, at)
  const domain = email.slice(at)
  const head = name.slice(0, 1)
  return `${head}${'•'.repeat(Math.max(2, name.length - 1))}${domain}`
}

export interface MailRoutingChange {
  /** Making this person the address SirReel writes to. */
  isPrimary?: boolean
  /** Copying this person on booking mail. */
  emailBookings?: boolean
}

/**
 * Does this change move where mail goes? Pure, so both write paths and the
 * tests agree. Turning something OFF never needs a code — it takes mail away
 * from someone, which is not the attack.
 */
export function needsMailRoutingCode(
  next: MailRoutingChange,
  current: MailRoutingChange = {},
): boolean {
  if (next.isPrimary === true && current.isPrimary !== true) return true
  if (next.emailBookings === true && current.emailBookings !== true) return true
  return false
}
