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

/**
 * NA is not a pass and not a gap — it is a requirement that does not apply to
 * THIS job. Today that is only the two auto checks on a job with no vehicle on
 * it (src/lib/coi/vehicleScope.ts). It reads as its own thing everywhere
 * because the alternative — quietly passing it — would make a gear-only
 * certificate look like it carried auto coverage the day a truck gets added.
 */
export type CoiCheckStatus = 'PASS' | 'FAIL' | 'UNKNOWN' | 'NA'
export type CoiCheckTier = 'CRITICAL' | 'ALERT'

export interface CoiChecklistRow {
  key: string
  label: string
  tier: CoiCheckTier
  status: CoiCheckStatus
  /** What the certificate actually says, when the review captured it. */
  found: string | null
  note: string | null
  /** PASS granted by evidence OUTSIDE this certificate (today: a separate
   *  Workers Comp cert filed on the job), so a surface can say why rather
   *  than implying the COI itself carried the coverage. */
  satisfiedElsewhere?: boolean
}

/** Evidence from outside this certificate that can satisfy a check. */
export interface CoiCheckContext {
  /** A separate WC certificate is on the job and it PASSED (not expired). */
  workersCompCoveredElsewhere?: boolean
  /** Human-readable provenance, e.g. "ADP Workers Comp cert, expires …". */
  workersCompNote?: string | null
  /**
   * Does the job rent the client a VEHICLE? `false` marks the two auto checks
   * NA. Undefined — a caller with no job in hand — means "assume it does",
   * because over-asking is an awkward email and under-asking is an uninsured
   * truck. See src/lib/coi/vehicleScope.ts.
   */
  vehiclesOnJob?: boolean | null
  /**
   * Is an EQUIPMENT partner's unit going out on this job? `true` promotes
   * Entertainment / Rented Equipment from ALERT to CRITICAL, because on a
   * partner unit that coverage is not a nice-to-have — it is the chain the
   * Partner Equipment Agreement §4 promises the partner in writing, and the
   * only thing behind it if it is absent is SirReel's own balance sheet.
   * Undefined or false leaves the check where it has always been. See
   * src/lib/coi/partnerEquipmentScope.ts.
   */
  partnerEquipmentOnJob?: boolean | null
  /** Whose equipment, for the reviewer-facing note. */
  partnerEquipmentNote?: string | null
}

/** The requirements that exist only because a client is driving our truck. */
export const AUTO_CHECK_KEYS: ReadonlySet<string> = new Set(['autoLiability', 'autoPhysicalDamage'])

/** Why an auto row is NA, in the reviewer's words. */
export const NO_VEHICLE_NOTE = 'Not required — this job rents no vehicle from SirReel.'

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
export function coiChecklist(
  ai: CoiAiResponse | null | undefined,
  ctx?: CoiCheckContext,
): CoiChecklistRow[] {
  if (!ai) return []
  const build = (key: string, tier: CoiCheckTier): CoiChecklistRow => {
    const item = asItem(ai[key])
    // No truck, no auto requirement. Deliberately BEFORE the stored verdict
    // is read: the review prompt is job-blind and will have marked a
    // gear-only certificate's Hired Auto Physical Damage as failing. That
    // verdict is correct about the document and wrong about the job.
    if (ctx?.vehiclesOnJob === false && AUTO_CHECK_KEYS.has(key)) {
      return {
        key,
        label: COI_CHECK_LABELS[key] || key,
        tier,
        status: 'NA',
        found: item ? str(item.found) : null,
        note: NO_VEHICLE_NOTE,
      }
    }
    // A partner's generator on the job makes the equipment floater load-
    // bearing rather than advisory: Partner Equipment Agreement §4 tells the
    // partner this coverage reaches their Unit, and §5 leaves SirReel paying
    // its actual cash value when it doesn't. Promoted BEFORE the stored
    // verdict is read, like the auto scoping above — the review prompt is
    // job-blind and tiers every certificate the same way.
    if (key === 'entertainmentPackage' && ctx?.partnerEquipmentOnJob === true) {
      const promotedNote = ctx.partnerEquipmentNote
        ? `Required on this job — ${ctx.partnerEquipmentNote}.`
        : 'Required on this job — a partner’s equipment is going out on it.'
      return {
        key,
        label: COI_CHECK_LABELS[key] || key,
        tier: 'CRITICAL',
        status: statusOf(key, ai),
        found: item ? str(item.found) : null,
        note: [str(item?.note), promotedNote].filter(Boolean).join(' '),
      }
    }
    // Workers' Comp satisfied by a SEPARATE certificate on the job
    // (Wes 2026-09-01: "a review of the COI work comp section should
    // not have a warning if a work comp policy was separately uploaded
    // and passed"). WC legitimately lives on a payroll company's own
    // certificate — the review prompt says so itself — so the absence
    // of WC on THIS document is not a gap when the proof is on file
    // beside it. Only a PASSING, unexpired WC cert satisfies it; one
    // that failed or expired leaves the warning exactly where it was.
    if (key === 'workersComp' && ctx?.workersCompCoveredElsewhere) {
      return {
        key,
        label: COI_CHECK_LABELS[key] || key,
        tier,
        status: 'PASS',
        found: ctx.workersCompNote ?? 'Covered by a separate Workers Comp certificate on this job',
        note: item ? str(item.note) : null,
        satisfiedElsewhere: true,
      }
    }
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
export function coiFlags(ai: CoiAiResponse | null | undefined, ctx?: CoiCheckContext): CoiFlags {
  const rows = coiChecklist(ai, ctx)
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

  // NA is neither open nor a pass — a requirement this job does not have.
  const open = (r: CoiChecklistRow) => r.status !== 'PASS' && r.status !== 'NA'
  const criticalOpen = rows.filter((r) => r.tier === 'CRITICAL' && open(r))
  const alertOpen = rows.filter((r) => r.tier === 'ALERT' && open(r))
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
/**
 * Would this certificate still clear if the job gained a vehicle tomorrow?
 *
 * The point of the whole scope idea is that the requirement comes BACK. A
 * gear-only job whose certificate shows no auto coverage is fine today and is
 * a hole the moment someone adds a truck, so the surfaces that sign off on it
 * have to be able to say which kind of "fine" they are looking at.
 */
export function coiCoversVehicles(ai: CoiAiResponse | null | undefined): boolean {
  const rows = coiChecklist(ai)
  const auto = rows.filter((r) => AUTO_CHECK_KEYS.has(r.key))
  return auto.length > 0 && auto.every((r) => r.status === 'PASS')
}

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
export function coiCheckWriteFields(ai: CoiAiResponse, ctx?: CoiCheckContext): {
  aiResponse: object
  aiRiskLevel: string
  aiRecommendation: string
  namedInsured: string | null
  policyExpiryDate: Date | null
  additionalInsured: boolean
} {
  // ctx so the recommendation matches what a reviewer will be shown: a
  // gear-only job's missing auto coverage is not a reason to flag a
  // certificate for review (src/lib/coi/vehicleScope.ts).
  const flags = coiFlags(ai, ctx)
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
