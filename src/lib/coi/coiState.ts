/**
 * The ONE answer to "what state is this certificate in" — shared by the
 * /jobs list rollup and the job detail's paperwork strip.
 *
 * Why shared (2026-09-06): the two surfaces had their own rules and told
 * Wes opposite stories about the same job. The list said VERIFIED only on
 * a human APPROVED + AI coverage; the detail said "Verified" on the AI
 * read alone. SR-JOB-0311's certificate was PENDING review with coverage
 * read as OK — so the tile listed COI as missing while the page it
 * opened onto showed a green "Verified". Same row, two verdicts.
 *
 * The human decision is the verdict. The review desk exists precisely so
 * a certificate the AI liked still gets a person's sign-off (five of the
 * stored certs were failing a required check on 2026-08-25 despite an
 * AI pass), and the company carry-forward already refuses anything but
 * APPROVED. PENDING with coverage read as OK is "in flight", and both
 * surfaces now say so.
 */

export type CoiRollupState = 'NONE' | 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'ISSUE'

export interface CoiStateInputs {
  /** ReviewDecision — typed loosely because the detail page reads it off a
   *  JSON payload as a string. Compared against the enum's literals. */
  humanDecision: string
  policyExpiryDate: Date | string | null
  coverageVerified: boolean
  /** Scope the sign-off was made under — CoiCheck.decidedWithVehicles.
   *  Null on rows decided before the column existed. */
  decidedWithVehicles?: boolean | null
  /** What the job holds NOW (src/lib/coi/vehicleScope.ts). Null when the
   *  caller could not see the job; then no scope verdict is reached. */
  jobHasVehicles?: boolean | null
}

/**
 * A certificate approved for a gear-only job, on a job that now rents a truck.
 *
 * Wes, 2026-09-09, approving MITU NGL's certificate on a Starlink-only order:
 * "it needs to protect against someone adding a vehicle later and not having
 * the coverage." The sign-off was honest about the job in front of him; it
 * simply is not a sign-off about a vehicle, and a stored `coverageVerified`
 * boolean cannot tell the two apart on its own.
 *
 * Deliberately one-directional. Approved WITH vehicles and the vehicles later
 * come off — nothing reopens, because the certificate carries more coverage
 * than the job needs, which is not a problem.
 */
export function coiScopeGap(coi: CoiStateInputs): boolean {
  return coi.decidedWithVehicles === false && coi.jobHasVehicles === true
}

/** What to tell whoever is looking at the reopened certificate. */
export const COI_SCOPE_GAP_NOTE =
  'This certificate was approved for a job with no vehicle on it, so the auto ' +
  'requirements were not applied. The job now rents a vehicle — the certificate ' +
  'needs Auto Liability and Hired Auto Physical Damage before it goes out.'

export function rollupCoiState(
  coi: CoiStateInputs,
  now: Date = new Date(),
): { state: CoiRollupState; expiresAt: string | null } {
  const expiry = coi.policyExpiryDate ? new Date(coi.policyExpiryDate) : null
  const expiresAt = expiry && !isNaN(expiry.getTime()) ? expiry.toISOString() : null
  const expired = expiry ? expiry.getTime() < now.getTime() : false
  if (expired) return { state: 'EXPIRED', expiresAt }
  if (coi.humanDecision === 'REJECTED') return { state: 'ISSUE', expiresAt }
  // Ahead of the APPROVED branch on purpose: the sign-off is real, it just
  // does not reach this job any more. ISSUE, not PENDING — nobody is waiting
  // on a broker, someone has to look.
  if (coiScopeGap(coi)) return { state: 'ISSUE', expiresAt }
  if (coi.humanDecision === 'APPROVED' && coi.coverageVerified) return { state: 'VERIFIED', expiresAt }
  // PENDING / COUNTERED / APPROVED-without-coverage all read as "in flight".
  return { state: 'PENDING', expiresAt }
}

/** Staff-facing word for each state — the detail strip and the tile agree. */
export const COI_STATE_WORD: Record<CoiRollupState, string> = {
  NONE: 'Missing',
  PENDING: 'Pending review',
  VERIFIED: 'Verified',
  EXPIRED: 'Expired',
  ISSUE: 'Rejected',
}

/**
 * What the CLIENT is told about the desk's decision on their certificate.
 *
 * 2026-09-12: Wes clicked "Request fix" on No Slate's certificate. The desk
 * parks that as COUNTERED (the fix email went out, we are waiting on the
 * broker), the paperwork feed painted it with the REJECTED chip — and the
 * client portal, which only knew APPROVED and REJECTED, kept saying
 * "Reviewing". Three surfaces, three stories about one row. The portal's
 * badge and sentence now come from here, and the feed names the state
 * honestly ("Fix requested"), so nobody reads a request as a verdict.
 *
 * Empty sentence = nothing to add beyond the badge.
 */
export type CoiClientDecisionKind = 'success' | 'pending' | 'warning' | 'failed'

export function coiClientDecision(
  humanDecision: string,
  coverageVerified: boolean,
  decidedAt: Date | string | null = null,
): { label: string; kind: CoiClientDecisionKind; notice: string } {
  if (humanDecision === 'APPROVED') return { label: 'Approved', kind: 'success', notice: '' }
  if (humanDecision === 'REJECTED') {
    return {
      label: 'Rejected',
      kind: 'failed',
      notice:
        'This certificate did not meet the requirements below. Have your broker issue a ' +
        'corrected one and upload it here — it replaces this one for this job.',
    }
  }
  if (humanDecision === 'COUNTERED') {
    const d = decidedAt ? new Date(decidedAt) : null
    const when =
      d && !isNaN(d.getTime())
        ? ` on ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' })}`
        : ''
    return {
      label: 'Correction needed',
      kind: 'warning',
      notice:
        `We reviewed this certificate and emailed you${when} with what your broker needs to ` +
        'change. Once they issue the corrected certificate, upload it here — it replaces this ' +
        'one for this job.',
    }
  }
  if (coverageVerified) return { label: 'Received', kind: 'success', notice: '' }
  return { label: 'Reviewing', kind: 'pending', notice: '' }
}
