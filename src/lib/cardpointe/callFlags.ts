/**
 * Compliance checks over a recorded gateway call.
 *
 * These are Fiserv's own findings from the 2026-08-14 validation review,
 * turned into something that runs against our traffic continuously instead of
 * arriving by email once. Each flag corresponds to a defect they caught by
 * reading transactions we could not see:
 *
 *   cvv_on_mit         — a CVV reached the gateway on a charge SirReel
 *                        initiated with the cardholder absent (PCI-DSS)
 *   missing_cof_fields — a stored credential established without the full
 *                        Visa/Mastercard field set
 *   cnp_no_postal      — a card-not-present auth with no postal code, which
 *                        risks declines, downgrades and (with surcharging on)
 *                        leaves the gateway unable to judge fee eligibility
 *
 * All three authorize normally. That is the point: none of them fail loudly,
 * so without an explicit check they stay invisible until someone external
 * reads the transaction log back to us.
 *
 * Shared by the admin view and anything that later alerts on these, so the
 * two cannot drift into disagreeing about what counts as a violation.
 */

export type FlagCode = 'cvv_on_mit' | 'missing_cof_fields' | 'cnp_no_postal'

export interface CallFlag {
  code: FlagCode
  severity: 'critical' | 'warning'
  label: string
  detail: string
}

type Payload = Record<string, unknown> | null | undefined

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

export function flagsForCall(input: {
  operation: string
  request: Payload
  response: Payload
  cvvresp?: string | null
}): CallFlag[] {
  const req = obj(input.request)
  const res = obj(input.response)
  if (!req) return []

  const flags: CallFlag[] = []
  const cof = str(req.cof)
  const cvvresp = str(input.cvvresp) ?? (res ? str(res.cvvresp) : null)

  // A CVV on a merchant-initiated charge. The presence of any cvvresp means
  // one was sent — the value does not matter, matched or not.
  if (cof === 'M' && cvvresp) {
    flags.push({
      code: 'cvv_on_mit',
      severity: 'critical',
      label: 'CVV on merchant-initiated charge',
      detail: `Gateway returned cvvresp "${cvvresp}", so a CVV was sent on a charge the cardholder was not present for. Storing or replaying CVV violates PCI-DSS.`,
    })
  }

  // Establishing a stored credential requires all three fields together.
  if (str(req.cofpermission) === 'Y' && (!cof || !str(req.cofscheduled))) {
    const missing = [!cof && 'cof', !str(req.cofscheduled) && 'cofscheduled']
      .filter(Boolean)
      .join(' and ')
    flags.push({
      code: 'missing_cof_fields',
      severity: 'warning',
      label: 'Incomplete stored-credential fields',
      detail: `cofpermission was sent without ${missing}. The credential is stored but does not satisfy the Visa/Mastercard mandate.`,
    })
  }

  // Card-not-present auths carry a token in `account`; ACH carries bankaba.
  if (input.operation === 'auth' && req.account && !req.bankaba && !str(req.postal)) {
    flags.push({
      code: 'cnp_no_postal',
      severity: 'warning',
      label: 'No postal code on a card-not-present auth',
      detail:
        'Fiserv strongly recommends postal on every CNP authorization to prevent fraud and downgrades. With surcharging enabled the gateway also needs it to judge fee eligibility by region.',
    })
  }

  return flags
}
