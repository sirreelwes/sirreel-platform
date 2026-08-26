/**
 * Structured payment / ACH details (Wes ruled A). The free-text
 * `paymentDetails` blob was removed — these fields are the ONLY entry
 * path. Shared by the admin save route (validation), the email template,
 * and the authenticated job portal.
 *
 * SUPERSEDED: "NEVER rendered on any public/browser surface; delivered by
 * email only." That held while the only alternative was an unauthenticated
 * page. It no longer does, and it was defending the wrong property.
 *
 * These numbers are not secret — they are on every check a client mails and
 * in the accounts-payable file of everyone SirReel has invoiced. The risk is
 * SUBSTITUTION, not disclosure: invoice-redirect fraud, where an attacker in
 * an email thread swaps the routing number and the client pays them in good
 * faith. Email cannot defend against that; the recipient has no way to tell
 * an altered copy from a genuine one. A page served from sirreel.com over
 * TLS can.
 *
 * They may now be rendered to an AUTHENTICATED client in the job portal
 * (api/portal/job/payment-details, behind the same signed session that
 * guards the payment routes). Still never on an unauthenticated surface —
 * not for secrecy, but because an anonymous page is one an attacker can
 * clone and point a victim at.
 *
 * EXTENDED 2026-08-26 to the v2 paperwork portal
 * (api/portal/v2/[token]/payment-details), which authenticates by the
 * PaperworkRequest token in the URL rather than a session cookie. That is the
 * same credential the portal already takes a CREDIT CARD behind — if the
 * token is trusted enough to collect a client's card, it is trusted enough to
 * show numbers that are printed on every check they mail. The reason it had
 * to move: the card-authorization email now tells clients the other ways to
 * pay are in their portal, and its button opens the v2 paperwork portal,
 * which was the one place those details were missing.
 */

import { prisma } from '@/lib/prisma'

const SINGLETON = 'singleton'

/**
 * The client-facing payload, built ONCE for every portal that shows it.
 *
 * Two surfaces render this now (job portal, v2 paperwork portal) and they
 * authenticate differently. The auth belongs to each route; what "configured"
 * means and which fields cross the wire does not — a second hand-rolled copy
 * is how one surface ends up showing a field the other withholds.
 */
export async function loadClientPaymentDetails(): Promise<
  { configured: false } | { configured: true; details: PaymentDetailsRecord }
> {
  const s = (await prisma.siteSetting.findUnique({
    where: { id: SINGLETON },
    select: Object.fromEntries(PAYMENT_COLUMNS.map((c) => [c, true])),
  })) as Record<string, string | null> | null

  // Configured = payee + account number + ACH routing. Rendering a
  // half-filled panel would invite a client to pay against incomplete
  // instructions, which is worse than showing nothing.
  if (!(s?.paymentPayeeName && s?.paymentAccountNumber && s?.paymentRoutingAch)) {
    return { configured: false }
  }

  const out = {} as Record<string, string | null>
  for (const col of PAYMENT_COLUMNS) {
    // paymentPayeeName → payeeName. The column names ARE the field names
    // with one prefix, so the mapping is derived rather than restated.
    const field = col.slice('payment'.length)
    out[field.charAt(0).toLowerCase() + field.slice(1)] = s[col] ?? null
  }
  return { configured: true, details: out as unknown as PaymentDetailsRecord }
}

export interface PaymentDetailsRecord {
  payeeName: string | null
  bankName: string | null
  accountType: string | null
  accountNumber: string | null
  routingAch: string | null
  routingWire: string | null
  remittanceEmail: string | null
  bankAddress: string | null
  instructions: string | null
  /** Zelle tag the client sends to (e.g. "sirreel"), and the recipient name
   *  their banking app shows them to confirm before sending. */
  zelleHandle: string | null
  zelleName: string | null
}

/** The Prisma column names, for a field-name-only audit (never values). */
export const PAYMENT_FIELD_NAMES: readonly string[] = [
  'payeeName',
  'bankName',
  'accountType',
  'accountNumber',
  'routingAch',
  'routingWire',
  'remittanceEmail',
  'bankAddress',
  'instructions',
  'zelleHandle',
  'zelleName',
]

/**
 * The same list as the SiteSetting columns they live in. Derived, not
 * restated: a hand-kept second list is how a field gets added to the admin
 * form and silently never reaches the portals that render it.
 */
const PAYMENT_COLUMNS: readonly string[] = PAYMENT_FIELD_NAMES.map(
  (f) => `payment${f.charAt(0).toUpperCase()}${f.slice(1)}`,
)

/**
 * ABA routing-number check: exactly 9 digits and the mod-10 checksum
 * with the repeating 3-7-1 weights sums to a multiple of 10.
 */
export function isValidAbaRouting(raw: string): boolean {
  const s = raw.trim()
  if (!/^\d{9}$/.test(s)) return false
  const w = [3, 7, 1, 3, 7, 1, 3, 7, 1]
  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(s[i]) * w[i]
  return sum % 10 === 0
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Validate a submitted structured record. Returns the cleaned record on
 * success or a field-scoped error. FAIL-on-invalid — never
 * warn-and-allow (per ruling).
 */
export function validatePaymentDetails(
  input: Record<string, unknown>,
): { ok: true; record: PaymentDetailsRecord } | { ok: false; error: string; field: string } {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

  const payeeName = str(input.payeeName)
  const bankName = str(input.bankName)
  const accountType = str(input.accountType)
  const accountNumber = str(input.accountNumber)
  const routingAch = str(input.routingAch)
  const routingWire = str(input.routingWire)
  const remittanceEmail = str(input.remittanceEmail)
  const bankAddress = str(input.bankAddress)
  const instructions = str(input.instructions)
  const zelleHandle = str(input.zelleHandle)
  const zelleName = str(input.zelleName)

  // Required core fields.
  if (!payeeName) return { ok: false, field: 'payeeName', error: 'Payee / account holder name is required.' }
  if (!bankName) return { ok: false, field: 'bankName', error: 'Bank name is required.' }
  if (!accountType) return { ok: false, field: 'accountType', error: 'Account type is required.' }
  if (!accountNumber) return { ok: false, field: 'accountNumber', error: 'Account number is required.' }
  if (!/^\d+$/.test(accountNumber)) {
    return { ok: false, field: 'accountNumber', error: 'Account number must be digits only.' }
  }
  if (!routingAch) return { ok: false, field: 'routingAch', error: 'ACH routing number is required.' }
  if (!isValidAbaRouting(routingAch)) {
    return { ok: false, field: 'routingAch', error: 'ACH routing number must be a valid 9-digit ABA number (checksum failed).' }
  }
  if (!routingWire) return { ok: false, field: 'routingWire', error: 'Wire routing number is required.' }
  if (!isValidAbaRouting(routingWire)) {
    return { ok: false, field: 'routingWire', error: 'Wire routing number must be a valid 9-digit ABA number (checksum failed).' }
  }
  if (!remittanceEmail) return { ok: false, field: 'remittanceEmail', error: 'Remittance email is required.' }
  if (!EMAIL_RE.test(remittanceEmail)) {
    return { ok: false, field: 'remittanceEmail', error: 'Remittance email is not a valid email address.' }
  }

  // Zelle is OPTIONAL — not every merchant offers it, and a half-filled pair
  // is worse than none: a tag with no recipient name gives the payer nothing
  // to confirm against in their banking app, which is the one check that
  // catches sending to the wrong person.
  if (zelleHandle && !zelleName) {
    return { ok: false, field: 'zelleName', error: 'Add the Zelle recipient name so the payer can confirm it in their bank app.' }
  }
  if (zelleName && !zelleHandle) {
    return { ok: false, field: 'zelleHandle', error: 'Add the Zelle tag (email or phone) clients should send to.' }
  }

  return {
    ok: true,
    record: {
      payeeName,
      bankName,
      accountType,
      accountNumber,
      routingAch,
      routingWire,
      remittanceEmail,
      bankAddress: bankAddress || null,
      instructions: instructions || null,
      zelleHandle: zelleHandle || null,
      zelleName: zelleName || null,
    },
  }
}

/** True when the record is fully configured (auto-send eligible). */
export function isPaymentConfigured(r: PaymentDetailsRecord | null | undefined): boolean {
  return !!(
    r &&
    r.payeeName &&
    r.bankName &&
    r.accountType &&
    r.accountNumber &&
    r.routingAch &&
    r.routingWire &&
    r.remittanceEmail
  )
}
