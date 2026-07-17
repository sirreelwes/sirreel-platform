/**
 * Structured payment / ACH details (Wes ruled A). The free-text
 * `paymentDetails` blob was removed — these fields are the ONLY entry
 * path. Shared by the admin save route (validation) and the email
 * template (rendering). NEVER rendered on any public/browser surface;
 * delivered by email only.
 */

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
]

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
