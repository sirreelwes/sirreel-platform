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
 * Calendar days between pickup and return (1-day floor).
 *
 * Used for rate-type gating only. The total/breakdown math reads
 * billableDays directly — calendar duration is just the input that
 * decides which rate-type buckets the rep can choose from.
 */
export function calendarDays(pickup: Date, returnDate: Date): number {
  return Math.max(1, Math.ceil((returnDate.getTime() - pickup.getTime()) / 86400000))
}

/**
 * Which RateType options the UI should expose for a department + calendar
 * range. An empty array means no toggle — billing is direct multiplication
 * of billableDays.
 *
 *   - EXPENDABLES        — purchase-only, no toggle.
 *   - CAP_PER_WEEK depts — no toggle; rep enters billableDays directly.
 *                          The cap math is a SUGGESTED default produced by
 *                          the AI extractor (computeBillableDays), not
 *                          enforced by this layer.
 *   - STAGES             — DAILY always; WEEKLY at >7 calendar days;
 *                          MONTHLY at >28 calendar days.
 */
export function availableRateTypes(
  department: LineItemDepartment,
  pickup: Date,
  returnDate: Date
): RateType[] {
  if (department === 'EXPENDABLES') return []
  const rules = BILLING_RULES[department]
  if (rules.model === 'CAP_PER_WEEK') return []
  // STAGES (PERCENT_DISCOUNT)
  const days = calendarDays(pickup, returnDate)
  const types: RateType[] = ['DAILY']
  if (days > 7) types.push('WEEKLY')
  if (days > 28) types.push('MONTHLY')
  return types
}

/**
 * Default RateType — highest tier available for the given range.
 * For departments with no toggle, returns DAILY (vestigial storage value).
 */
export function defaultRateType(
  department: LineItemDepartment,
  pickup: Date,
  returnDate: Date
): RateType {
  if (department === 'EXPENDABLES') return 'FLAT'
  const list = availableRateTypes(department, pickup, returnDate)
  if (list.length === 0) return 'DAILY'
  if (list.includes('MONTHLY')) return 'MONTHLY'
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
 * Suggested default billable-day count for cap-per-week departments — the
 * AI extractor pre-fills this on new line items based on the calendar
 * duration. The rep is free to override.
 *
 *   billableDays = floor(actualDays / 7) * cap + min(actualDays % 7, cap)
 *
 * For GE (cap=7) this collapses to billableDays === actualDays.
 * For other models (PERCENT_DISCOUNT, PURCHASE) callers should bypass
 * this helper — STAGES bills calendar days directly, EXPENDABLES has no
 * day concept.
 */
export function computeBillableDays(actualDays: number, cap: number): number {
  const fullWeeks = Math.floor(actualDays / 7)
  const remainder = actualDays % 7
  return fullWeeks * cap + Math.min(remainder, cap)
}

/**
 * Single source of truth for line-item totals — used both client-side
 * for live UI display and server-side at write time. Server never
 * trusts a client-submitted total; always recompute from
 * (qty, rate, billableDays, rateType, department).
 *
 * Math is now direct multiplication. The cap auto-math we shipped previously
 * is a *suggested default* that the extractor pre-fills — the rep can
 * override billableDays freely without the system pushing back.
 */
export function computeLineTotal(item: BillingInput): number {
  const rate = asNumber(item.rate)
  const rules = BILLING_RULES[item.department]

  if (rules.model === 'PURCHASE') {
    return item.quantity * rate
  }

  let multiplier = 1.0
  if (rules.model === 'PERCENT_DISCOUNT') {
    if (item.rateType === 'WEEKLY') multiplier = rules.weekly
    if (item.rateType === 'MONTHLY') multiplier = rules.monthly
  }
  // CAP_PER_WEEK ignores rateType — billableDays is the source of truth,
  // however the rep arrived at it (cap suggestion accepted, manual override,
  // or zero for negotiated freebies).

  return item.quantity * rate * item.billableDays * multiplier
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

  if (rules.model === 'PERCENT_DISCOUNT' && (item.rateType === 'WEEKLY' || item.rateType === 'MONTHLY')) {
    const pct = item.rateType === 'WEEKLY' ? rules.weekly : rules.monthly
    const label = item.rateType === 'WEEKLY' ? 'weekly' : 'monthly'
    return `${item.quantity} × ${fmtMoney(rate)} × ${item.billableDays} days × ${Math.round(pct * 100)}% (${label}) = ${fmtMoney(total)}`
  }

  // CAP_PER_WEEK or STAGES DAILY — direct multiplication.
  return `${item.quantity} × ${fmtMoney(rate)} × ${item.billableDays} days = ${fmtMoney(total)}`
}
