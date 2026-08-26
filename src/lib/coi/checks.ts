import {
  ALERT_CHECK_KEYS,
  CRITICAL_CHECK_KEYS,
  type CoiAiResponse,
  type CoiCheckItem,
} from '@/lib/coi/reviewCoi'

/**
 * Reading a stored COI review — one interpretation, every surface.
 *
 * Three generations of review shape sit in the database and none of them are
 * going to be re-reviewed on demand:
 *   1. flat booleans only (the old review-desk prompt): overallPass,
 *      coverageVerified, additionalInsured, autoPhysicalDamage
 *   2. the paperwork portal's per-check objects + criticalPass/alertPass
 *   3. /tools/coi-check's per-check objects + hardPass/manageablePass
 *   4. today's unified shape
 *
 * Everything downstream — the desk checklist, the "what's still missing"
 * draft, the job's verified badge — reads through here, so a certificate
 * reviewed in 2026-05 and one reviewed today are judged by the same rules.
 *
 * An UNKNOWN check is never a pass. A review that never asked about Primary
 * & Non-Contributory has not confirmed it.
 */

export type CoiCheckStatus = 'PASS' | 'FAIL' | 'UNKNOWN'
export type CoiCheckTier = 'CRITICAL' | 'ALERT'

export interface CoiChecklistRow {
  key: string
  label: string
  tier: CoiCheckTier
  status: CoiCheckStatus
  /** What the certificate actually says, when the review captured it. */
  found: string | null
  note: string | null
}

export const COI_CHECK_LABELS: Record<string, string> = {
  certificateHolder: 'Certificate Holder: SirReel',
  generalLiability: 'General Liability ($1M / $2M)',
  autoLiability: 'Auto Liability ($1M, Hired & Non-Owned)',
  autoPhysicalDamage: 'Hired Auto Physical Damage',
  additionalInsured: 'Additional Insured: SirReel',
  lossPayee: 'Loss Payee: SirReel',
  coverageDates: 'Coverage dates cover the rental',
  policyExpiry: 'Policy not expired',
  primaryNonContributory: 'Primary & Non-Contributory',
  waiverOfSubrogation: 'Waiver of Subrogation',
  umbrella: 'Umbrella / Excess Liability',
  entertainmentPackage: 'Entertainment / Rented Equipment',
  workersComp: 'Workers Compensation',
  cancellationNotice: '30-day cancellation notice',
  contractorCoverage: 'Independent contractor coverage',
}

function asItem(v: unknown): CoiCheckItem | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as CoiCheckItem) : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function statusOf(key: string, ai: CoiAiResponse): CoiCheckStatus {
  const item = asItem(ai[key])
  if (!item) return 'UNKNOWN'
  // An expired policy fails whatever `pass` claims.
  if (key === 'policyExpiry') {
    if (item.expired === true) return 'FAIL'
    if (item.pass === true || item.expired === false) return 'PASS'
    return item.pass === false ? 'FAIL' : 'UNKNOWN'
  }
  if (item.pass === true) return 'PASS'
  if (item.pass === false) return 'FAIL'
  return 'UNKNOWN'
}

/** True when the stored review carries per-check verdicts at all. */
export function hasCoiChecklist(ai: CoiAiResponse | null | undefined): boolean {
  if (!ai) return false
  return [...CRITICAL_CHECK_KEYS, ...ALERT_CHECK_KEYS].some((k) => statusOf(k, ai) !== 'UNKNOWN')
}

/**
 * The full checklist, ordered critical-first. Rows the stored review never
 * judged come back UNKNOWN rather than being dropped — "nobody looked" is
 * the finding that matters on an older review.
 */
export function coiChecklist(ai: CoiAiResponse | null | undefined): CoiChecklistRow[] {
  if (!ai) return []
  const build = (key: string, tier: CoiCheckTier): CoiChecklistRow => {
    const item = asItem(ai[key])
    return {
      key,
      label: COI_CHECK_LABELS[key] || key,
      tier,
      status: statusOf(key, ai),
      found: item ? str(item.found) ?? (key === 'policyExpiry' ? str(item.date) : null) : null,
      note: item ? str(item.note) : null,
    }
  }
  return [
    ...CRITICAL_CHECK_KEYS.map((k) => build(k, 'CRITICAL')),
    ...ALERT_CHECK_KEYS.map((k) => build(k, 'ALERT')),
  ]
}

export interface CoiFlags {
  /** The stored review carries per-check verdicts. */
  hasChecklist: boolean
  /** Every critical requirement confirmed. Gates "coverage verified". */
  criticalPass: boolean
  /** Every alert requirement confirmed. */
  alertPass: boolean
  /** Both. A certificate with nothing left to discuss. */
  overallPass: boolean
  /** Critical requirements not confirmed (failed or never looked at). */
  criticalOpen: CoiChecklistRow[]
  /** Alert requirements not confirmed. */
  alertOpen: CoiChecklistRow[]
  riskLevel: 'low' | 'medium' | 'high'
}

/**
 * The rollups, recomputed from the checks rather than trusted from the
 * stored summary field — a review whose `overallPass: true` predates half
 * the checks is not a pass, it is an incomplete review.
 */
export function coiFlags(ai: CoiAiResponse | null | undefined): CoiFlags {
  const rows = coiChecklist(ai)
  const hasChecklist = hasCoiChecklist(ai)

  if (!hasChecklist) {
    // Legacy flat-boolean review. Only the four fields it carried can be
    // believed; everything else is unconfirmed, so it can never read as a
    // full pass — which is exactly what the re-run is for.
    const legacyPass =
      ai?.overallPass === true &&
      ai?.coverageVerified !== false &&
      ai?.additionalInsured !== false &&
      ai?.autoPhysicalDamage !== false
    return {
      hasChecklist: false,
      criticalPass: legacyPass,
      alertPass: false,
      overallPass: false,
      criticalOpen: [],
      alertOpen: [],
      riskLevel: legacyPass ? 'low' : 'high',
    }
  }

  const criticalOpen = rows.filter((r) => r.tier === 'CRITICAL' && r.status !== 'PASS')
  const alertOpen = rows.filter((r) => r.tier === 'ALERT' && r.status !== 'PASS')
  const criticalPass = criticalOpen.length === 0
  const alertPass = alertOpen.length === 0

  return {
    hasChecklist: true,
    criticalPass,
    alertPass,
    overallPass: criticalPass && alertPass,
    criticalOpen,
    alertOpen,
    riskLevel: !criticalPass ? 'high' : !alertPass ? 'medium' : 'low',
  }
}

/** Did the review confirm SirReel is an Additional Insured? */
export function coiAdditionalInsured(ai: CoiAiResponse | null | undefined): boolean {
  if (!ai) return false
  const item = asItem(ai.additionalInsured)
  if (item) return item.pass === true
  return ai.additionalInsured === true
}

/**
 * The CoiCheck columns a fresh review writes. Four routes persisted this by
 * hand and had already drifted on which field decided "accept" — here the
 * recommendation follows the CRITICAL checks, so an alert-only gap (no
 * waiver, no umbrella) reaches the desk as something to look at rather than
 * silently blocking the certificate.
 */
export function coiCheckWriteFields(ai: CoiAiResponse): {
  aiResponse: object
  aiRiskLevel: string
  aiRecommendation: string
  namedInsured: string | null
  policyExpiryDate: Date | null
  additionalInsured: boolean
} {
  const flags = coiFlags(ai)
  const expiry =
    typeof ai.policyExpiryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ai.policyExpiryDate)
      ? new Date(ai.policyExpiryDate)
      : null
  return {
    aiResponse: ai as object,
    aiRiskLevel: flags.riskLevel,
    aiRecommendation: flags.criticalPass ? 'accept' : 'review',
    namedInsured:
      typeof ai.namedInsured === 'string' && ai.namedInsured.trim() ? ai.namedInsured.trim().slice(0, 300) : null,
    policyExpiryDate: expiry,
    additionalInsured: coiAdditionalInsured(ai),
  }
}
