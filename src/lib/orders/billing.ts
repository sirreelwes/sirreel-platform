import type { LineItemDepartment, RateType } from '@prisma/client'

/**
 * Department-aware billing rules.
 *
 *   CAP_PER_WEEK     — DAILY bills every day; WEEKLY bills only `cap`
 *                      days per 7-day window. GE = 7 (no discount),
 *                      VEHICLES = 5, COMMUNICATIONS / PRO_SUPPLIES /
 *                      ART = 3 (3-day cap).
 *   PERCENT_DISCOUNT — STAGES: bills every day, multiplied by the
 *                      rateType-specific multiplier (1.0 daily, 0.90
 *                      weekly, 0.75 monthly).
 *   PURCHASE         — EXPENDABLES: qty × rate, no billableDays concept.
 */
export type BillingRule =
  | { model: 'CAP_PER_WEEK'; cap: number }
  | { model: 'PERCENT_DISCOUNT'; weekly: number; monthly: number }
  | { model: 'PURCHASE' }

export const BILLING_RULES: Record<LineItemDepartment, BillingRule> = {
  COMMUNICATIONS: { model: 'CAP_PER_WEEK', cap: 3 },
  PRO_SUPPLIES:   { model: 'CAP_PER_WEEK', cap: 3 },
  ART:            { model: 'CAP_PER_WEEK', cap: 3 },
  VEHICLES:       { model: 'CAP_PER_WEEK', cap: 5 },
  GE:             { model: 'CAP_PER_WEEK', cap: 7 },
  STAGES:         { model: 'PERCENT_DISCOUNT', weekly: 0.90, monthly: 0.75 },
  EXPENDABLES:    { model: 'PURCHASE' },
}

/**
 * Which RateType options the UI should expose for a (department, days) pair.
 * An empty array means the user has no toggle — billing is determined
 * automatically by the department's BillingRule.
 *
 *   - EXPENDABLES — purchase-only, no toggle, no rentalDays.
 *   - CAP_PER_WEEK depts (COM, PRO_SUPPLIES, ART, VEHICLES, GE) — cap math
 *     ALWAYS applies based on rentalDays alone; no toggle.
 *   - STAGES — DAILY always; WEEKLY at >7 days; MONTHLY at >28 days. Each
 *     option represents a negotiated discount level.
 */
export function availableRateTypes(
  department: LineItemDepartment,
  rentalDays: number
): RateType[] {
  if (department === 'EXPENDABLES') return []
  const rules = BILLING_RULES[department]
  if (rules.model === 'CAP_PER_WEEK') return []
  // STAGES (PERCENT_DISCOUNT)
  const types: RateType[] = ['DAILY']
  if (rentalDays > 7) types.push('WEEKLY')
  if (rentalDays > 28) types.push('MONTHLY')
  return types
}

/**
 * Pick a sensible default RateType from the available list — the highest
 * tier that's available. Used by the auto-reset logic when the user
 * changes department or rentalDays in a way that invalidates the current
 * rateType. For departments with no user-facing toggle, returns DAILY as
 * a vestigial-but-harmless storage value.
 */
export function defaultRateType(
  department: LineItemDepartment,
  rentalDays: number
): RateType {
  if (department === 'EXPENDABLES') return 'FLAT'
  const list = availableRateTypes(department, rentalDays)
  if (list.length === 0) return 'DAILY' // cap-per-week: rateType is vestigial
  if (list.includes('WEEKLY')) return 'WEEKLY'
  return list[0]
}

interface DecimalLike { toNumber(): number }

export interface BillingInput {
  quantity: number
  rate: number | DecimalLike
  billableDays: number
  rateType: RateType
  department: LineItemDepartment
}

function asNumber(r: number | DecimalLike): number {
  return typeof r === 'number' ? r : r.toNumber()
}

/**
 * Cap-per-week billable-day formula, exposed for breakdown rendering.
 *
 *   billableDays = floor(rentalDays / 7) * cap + min(rentalDays % 7, cap)
 *
 * For GE (cap=7) this collapses to billableDays === rentalDays.
 */
export function capBillableDays(rentalDays: number, cap: number): number {
  const fullWeeks = Math.floor(rentalDays / 7)
  const remainder = rentalDays % 7
  return fullWeeks * cap + Math.min(remainder, cap)
}

/**
 * Single source of truth for line-item totals — used both client-side
 * for live UI display and server-side at write time. Server should never
 * trust a client-submitted total; recompute from (qty, rate, days,
 * rateType, department).
 *
 * NOTE: rateType is only consulted for STAGES (PERCENT_DISCOUNT). For
 * CAP_PER_WEEK departments the cap math always applies regardless of
 * the rateType column value (the column is now vestigial for those
 * departments and may carry legacy WEEKLY values from older data).
 */
export function computeLineTotal(item: BillingInput): number {
  const rate = asNumber(item.rate)
  const rules = BILLING_RULES[item.department]

  if (rules.model === 'PURCHASE') {
    return item.quantity * rate
  }

  if (rules.model === 'PERCENT_DISCOUNT') {
    let multiplier = 1.0
    if (item.rateType === 'WEEKLY') multiplier = rules.weekly
    if (item.rateType === 'MONTHLY') multiplier = rules.monthly
    return item.quantity * rate * item.billableDays * multiplier
  }

  // CAP_PER_WEEK — always cap, regardless of rateType.
  const billable = capBillableDays(item.billableDays, rules.cap)
  return item.quantity * rate * billable
}

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

/**
 * Human-readable breakdown rendered under each line item in the builder.
 * Mirrors the math in computeLineTotal so users can audit the total at a
 * glance.
 */
export function billingBreakdown(item: BillingInput): string {
  const rate = asNumber(item.rate)
  const rules = BILLING_RULES[item.department]
  const total = computeLineTotal(item)

  if (rules.model === 'PURCHASE') {
    return `${item.quantity} × ${fmtMoney(rate)} = ${fmtMoney(total)}`
  }

  if (rules.model === 'PERCENT_DISCOUNT') {
    if (item.rateType === 'WEEKLY' || item.rateType === 'MONTHLY') {
      const pct = item.rateType === 'WEEKLY' ? rules.weekly : rules.monthly
      const label = item.rateType === 'WEEKLY' ? 'weekly' : 'monthly'
      return `${item.quantity} × ${fmtMoney(rate)} × ${item.billableDays} days × ${Math.round(pct * 100)}% (${label}) = ${fmtMoney(total)}`
    }
    return `${item.quantity} × ${fmtMoney(rate)} × ${item.billableDays} days = ${fmtMoney(total)}`
  }

  // CAP_PER_WEEK — cap always applies; rateType is vestigial.
  const billable = capBillableDays(item.billableDays, rules.cap)
  if (billable === item.billableDays) {
    // Cap didn't kick in (short rental, or GE cap=7).
    return `${item.quantity} × ${fmtMoney(rate)} × ${item.billableDays} days = ${fmtMoney(total)}`
  }
  return `${item.quantity} × ${fmtMoney(rate)} × ${billable} billable days (${item.billableDays}-day rental, ${rules.cap}-day cap) = ${fmtMoney(total)}`
}
