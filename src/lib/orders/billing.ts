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
 *   PURCHASE         — EXPENDABLES: qty × rate, no rentalDays concept.
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
 *   - EXPENDABLES is always FLAT (one-time purchase, no rentalDays).
 *   - DAILY is always available for non-expendable items.
 *   - WEEKLY unlocks above 7 days.
 *   - MONTHLY unlocks above 28 days, and only for STAGES.
 */
export function availableRateTypes(
  department: LineItemDepartment,
  rentalDays: number
): RateType[] {
  if (department === 'EXPENDABLES') return ['FLAT']
  const types: RateType[] = ['DAILY']
  if (rentalDays > 7) types.push('WEEKLY')
  if (department === 'STAGES' && rentalDays > 28) types.push('MONTHLY')
  return types
}

/**
 * Pick a sensible default RateType from the available list — the highest
 * tier that's available. Used by the auto-reset logic when the user
 * changes department or rentalDays in a way that invalidates the current
 * rateType.
 */
export function defaultRateType(
  department: LineItemDepartment,
  rentalDays: number
): RateType {
  const list = availableRateTypes(department, rentalDays)
  if (list.includes('WEEKLY')) return 'WEEKLY'
  if (list.includes('DAILY')) return 'DAILY'
  return list[0]
}

interface DecimalLike { toNumber(): number }

export interface BillingInput {
  quantity: number
  rate: number | DecimalLike
  rentalDays: number
  rateType: RateType
  department: LineItemDepartment
}

function asNumber(r: number | DecimalLike): number {
  return typeof r === 'number' ? r : r.toNumber()
}

/**
 * Single source of truth for line-item totals — used both client-side
 * for live UI display and server-side at write time. Server should never
 * trust a client-submitted total; recompute from (qty, rate, days,
 * rateType, department).
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
    return item.quantity * rate * item.rentalDays * multiplier
  }

  // CAP_PER_WEEK
  if (item.rateType === 'DAILY') {
    return item.quantity * rate * item.rentalDays
  }
  if (item.rateType === 'WEEKLY') {
    let total = 0
    let remaining = item.rentalDays
    while (remaining > 0) {
      const daysInPeriod = Math.min(remaining, 7)
      const billable = Math.min(daysInPeriod, rules.cap)
      total += item.quantity * rate * billable
      remaining -= daysInPeriod
    }
    return total
  }
  // FLAT (or any unhandled rate type for a cap dept) — qty × rate.
  return item.quantity * rate
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
      return `${item.quantity} × ${fmtMoney(rate)} × ${item.rentalDays} days × ${Math.round(pct * 100)}% (${label}) = ${fmtMoney(total)}`
    }
    return `${item.quantity} × ${fmtMoney(rate)} × ${item.rentalDays} days = ${fmtMoney(total)}`
  }

  // CAP_PER_WEEK
  if (item.rateType === 'DAILY') {
    return `${item.quantity} × ${fmtMoney(rate)} × ${item.rentalDays} days = ${fmtMoney(total)}`
  }
  if (item.rateType === 'WEEKLY') {
    let billableDays = 0
    let remaining = item.rentalDays
    let weeks = 0
    while (remaining > 0) {
      const daysInPeriod = Math.min(remaining, 7)
      billableDays += Math.min(daysInPeriod, rules.cap)
      weeks += 1
      remaining -= daysInPeriod
    }
    const capLabel = `${rules.cap}-day cap`
    const weekLabel = weeks > 1 ? ` × ${weeks} weeks` : ''
    return `${item.quantity} × ${fmtMoney(rate)} × ${billableDays} billable days (${capLabel}${weekLabel}) = ${fmtMoney(total)}`
  }
  // FLAT fallback.
  return `${item.quantity} × ${fmtMoney(rate)} = ${fmtMoney(total)}`
}
