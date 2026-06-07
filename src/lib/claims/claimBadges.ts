/**
 * Claim badge computation — derived on read, no schema columns.
 *
 * Mirrors src/lib/crm/clientBadges.ts: pure server-side fact
 * computation, no I/O. The list endpoint runs this over each row
 * before responding so the client doesn't redo the math (and the
 * thresholds live in ONE place).
 *
 * Badge meanings:
 *   OVERDUE_RESPONSE  — nextActionAt is past today AND status isn't
 *                       a terminal one (SETTLED / CLOSED / DENIED).
 *                       "The carrier promised something on date X
 *                       and we haven't moved." Drives the
 *                       neutral→warn→bad escalation as the gap
 *                       widens past the threshold.
 *   GONE_QUIET        — lastContactAt is older than QUIET_DAYS AND
 *                       claim is in flight (SUBMITTED / ACKNOWLEDGED
 *                       / NEGOTIATING). "We submitted and nobody is
 *                       talking back."
 *   HIGH_EXPOSURE     — clientExposure ≥ HIGH_EXPOSURE_THRESHOLD.
 *                       The number Ana wants to see at-a-glance
 *                       when prioritizing follow-ups.
 *   STALE_NEGOTIATING — status === 'NEGOTIATING' for longer than
 *                       STALE_NEGOTIATING_DAYS. Surfaces deals
 *                       that have been parked.
 *   LD_INVOICE_OVERDUE — the linked LD invoice is past its dueDate
 *                       with a non-zero balance. Cross-axis signal:
 *                       client is behind on billing on this same
 *                       claim's invoice.
 *   ESCALATED         — status === 'ESCALATED'. Always shown so
 *                       escalated claims sort to the top.
 *   MISSING_COI       — no coiCheckId AND status in flight. A claim
 *                       without a COI on file is materially harder
 *                       to argue.
 */

export type ClaimBadge =
  | 'OVERDUE_RESPONSE'
  | 'GONE_QUIET'
  | 'HIGH_EXPOSURE'
  | 'STALE_NEGOTIATING'
  | 'LD_INVOICE_OVERDUE'
  | 'ESCALATED'
  | 'MISSING_COI'
  // Fires on DRAFT claims that the claims@ → onboarding helper auto-
  // created from a forwarded email. Surfaces "this isn't a real claim
  // yet — Ana, sign off." Cleared the moment the claim moves out of
  // DRAFT via the normal PATCH lifecycle.
  | 'FROM_EMAIL_REVIEW'

// Tunable thresholds. Same export pattern as REPEAT_MIN / LOYAL_YEARS
// in clientBadges.ts so they're discoverable from one place.
export const QUIET_DAYS = 14
export const STALE_NEGOTIATING_DAYS = 45
export const HIGH_EXPOSURE_THRESHOLD = 5_000

const IN_FLIGHT: ReadonlySet<string> = new Set([
  'SUBMITTED', 'ACKNOWLEDGED', 'NEGOTIATING',
])
const TERMINAL: ReadonlySet<string> = new Set([
  'SETTLED', 'CLOSED', 'DENIED',
])

export interface ClaimBadgeInput {
  status: string
  nextActionAt: Date | string | null | undefined
  lastContactAt: Date | string | null | undefined
  clientExposure: number | null | undefined
  coiCheckId: string | null | undefined
  // Linked LD invoice — only set when the claim has one. Pass
  // { dueDate, balanceDue } as the minimum shape; everything else
  // is ignored.
  invoice?: {
    type: string
    dueDate: Date | string | null
    balanceDue: number | string | null
  } | null
  // Last status-change time — defaults to the claim's `updatedAt`
  // since we don't track per-field change timestamps. Good-enough
  // proxy for "how long has this been in NEGOTIATING."
  statusUpdatedAt: Date | string
  // True when InsuranceClaim.onboardedFromEmailMessageId is non-null —
  // i.e. this claim was auto-drafted from a forwarded claims@ email
  // and is awaiting Ana's review. Drives FROM_EMAIL_REVIEW.
  fromEmailDraft?: boolean
}

export interface ClaimBadgeFacts {
  badges: ClaimBadge[]
  // Severity score — higher = more urgent. Used by the list to sort
  // attention-needing claims to the top. SETTLED/CLOSED stay at 0.
  severity: number
}

function daysSince(t: Date | string | null | undefined, now: Date): number | null {
  if (t == null) return null
  const d = t instanceof Date ? t : new Date(t)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000)
}
function daysUntil(t: Date | string | null | undefined, now: Date): number | null {
  const s = daysSince(t, now)
  return s == null ? null : -s
}

export function computeClaimBadgeFacts(
  input: ClaimBadgeInput,
  now: Date = new Date(),
): ClaimBadgeFacts {
  const badges: ClaimBadge[] = []
  const status = input.status

  // ESCALATED — always sort to top.
  if (status === 'ESCALATED') badges.push('ESCALATED')

  // OVERDUE_RESPONSE — only meaningful when not terminal.
  if (!TERMINAL.has(status) && input.nextActionAt) {
    const overdueDays = daysSince(input.nextActionAt, now)
    if (overdueDays != null && overdueDays > 0) badges.push('OVERDUE_RESPONSE')
  }

  // GONE_QUIET — claim is in-flight + we haven't heard anything in a
  // while. lastContactAt unset doesn't fire (we may just not have
  // recorded it); only set + stale triggers.
  if (IN_FLIGHT.has(status) && input.lastContactAt) {
    const sinceContact = daysSince(input.lastContactAt, now)
    if (sinceContact != null && sinceContact >= QUIET_DAYS) badges.push('GONE_QUIET')
  }

  // HIGH_EXPOSURE — dollar threshold. Only fires when exposure is
  // computable AND non-terminal (settled/denied claims aren't
  // actionable on this axis).
  if (!TERMINAL.has(status) && input.clientExposure != null && input.clientExposure >= HIGH_EXPOSURE_THRESHOLD) {
    badges.push('HIGH_EXPOSURE')
  }

  // STALE_NEGOTIATING — parked deals.
  if (status === 'NEGOTIATING') {
    const inStatusDays = daysSince(input.statusUpdatedAt, now) ?? 0
    if (inStatusDays >= STALE_NEGOTIATING_DAYS) badges.push('STALE_NEGOTIATING')
  }

  // LD_INVOICE_OVERDUE — the linked LD invoice is past due with a
  // balance. Cross-axis signal: client is behind on the billing
  // side of the same claim.
  if (input.invoice && input.invoice.type === 'LD' && input.invoice.dueDate && input.invoice.balanceDue) {
    const balance = typeof input.invoice.balanceDue === 'string'
      ? Number(input.invoice.balanceDue)
      : input.invoice.balanceDue
    const overdue = daysSince(input.invoice.dueDate, now)
    if (overdue != null && overdue > 0 && balance > 0) {
      badges.push('LD_INVOICE_OVERDUE')
    }
  }

  // MISSING_COI — only meaningful when the claim is in flight.
  // SETTLED claims without a COI aren't actionable on this axis.
  if (IN_FLIGHT.has(status) && !input.coiCheckId) {
    badges.push('MISSING_COI')
  }

  // FROM_EMAIL_REVIEW — auto-drafted from a forwarded claims@ email,
  // still in DRAFT. Cleared as soon as the rep moves it to any other
  // lifecycle state. Acts as the "Ana, please sign off" surface.
  if (status === 'DRAFT' && input.fromEmailDraft) {
    badges.push('FROM_EMAIL_REVIEW')
  }

  // Severity rollup — same neutral→warn→bad palette logic the chip
  // tones use. ESCALATED + OVERDUE_RESPONSE + HIGH_EXPOSURE +
  // LD_INVOICE_OVERDUE escalate to "bad"; the rest are "warn"; the
  // floor is 0 for terminal claims with no flags.
  let severity = 0
  if (badges.includes('ESCALATED'))          severity += 100
  if (badges.includes('LD_INVOICE_OVERDUE')) severity += 60
  if (badges.includes('OVERDUE_RESPONSE'))   severity += 50
  if (badges.includes('HIGH_EXPOSURE'))      severity += 40
  if (badges.includes('GONE_QUIET'))         severity += 30
  if (badges.includes('STALE_NEGOTIATING'))  severity += 20
  if (badges.includes('FROM_EMAIL_REVIEW'))  severity += 15
  if (badges.includes('MISSING_COI'))        severity += 10

  return { badges, severity }
}
