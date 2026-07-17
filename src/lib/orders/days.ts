/**
 * Billable-days authority (Wes ruling B, 2026-07-17).
 *
 * Three numbers, strict roles:
 *   computedDays — server-derived from the line's own dates. The
 *     reference. Never client-writable.
 *   claimedDays  — the client's shoot-days REQUEST from the public
 *     form. NEVER prices anything on its own.
 *   billableDays — agent-approved, AUTHORITATIVE when set. May be
 *     above OR below claimedDays/computedDays — SirReel has final say;
 *     no clamping anywhere.
 *
 * Price resolution: billableDays ?? computedDays. The pre-existing
 * "NULL billableDays = rate-card / dates-TBD" behavior inside
 * computeLineTotal is untouched — claims flow into pricing ONLY by an
 * agent writing billableDays.
 */

/**
 * RULED-PENDING: whether Sat+Sun collapse into one billable day.
 * Wes must rule before this flips — flipping it changes money math on
 * every daily-rate line. No collapsing is implemented behind it yet;
 * the constant exists so the future implementation has exactly one
 * switch to find.
 */
export const WEEKEND_AS_ONE_DAY = false

/**
 * Server-side day count for a rental window: max(1, return − pickup)
 * in whole days. Same-day rentals bill one day.
 */
export function computeDays(pickupDate: Date | string, returnDate: Date | string): number {
  const p = new Date(pickupDate)
  const r = new Date(returnDate)
  p.setUTCHours(0, 0, 0, 0)
  r.setUTCHours(0, 0, 0, 0)
  const diff = Math.round((r.getTime() - p.getTime()) / 86_400_000)
  return Math.max(1, diff)
}

/** Authoritative day count for pricing/labels: billableDays ?? computedDays. */
export function resolveBillableDays(line: {
  billableDays: number | null
  computedDays: number | null
}): number | null {
  return line.billableDays ?? line.computedDays ?? null
}

/**
 * Shoot-days claims apply to EQUIPMENT and VEHICLE lines ONLY. Stage
 * lines always price on possession days — a stage is occupied whether
 * or not anyone's shooting — and never show or accept the field.
 */
export function isClaimEligible(line: { type: string; department?: string | null }): boolean {
  if (line.department === 'STAGES') return false
  return line.type === 'VEHICLE' || line.type === 'EQUIPMENT'
}

/** Sanity bounds for a client-sent claim — a REQUEST, not a price. */
export function sanitizeClaimedDays(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN
  if (!Number.isInteger(n)) return null
  if (n < 1 || n > 365) return null
  return n
}
