/**
 * Pure preview of a date push on an order. Given the current order +
 * line items + discounts and a proposed new range (plus per-custom-item
 * actions), returns the projected line items, billable-day deltas, and
 * full totals breakdown via the shared `computeOrderTotals` util — no
 * I/O, no writes.
 *
 * Three classes of line item:
 *
 *   1. Inherited (startDate IS NULL AND endDate IS NULL) — pickup/return
 *      follow the order range. New billable days computed from new
 *      calendar days via the department-aware `computeBillableDays`
 *      (CAP_PER_WEEK applies the cap; STAGES bills calendar days
 *      directly; EXPENDABLES has no day concept).
 *
 *   2. Custom + action='shift' — startDate and endDate (and the resolved
 *      pickup/return) move by the same offset as the order range.
 *      Billable days re-derived from the new custom range.
 *
 *   3. Custom + action='keep' — left alone. Billable days, dates, and
 *      lineTotal stay identical to current.
 *
 * The util is symmetric: the apply endpoint calls it to derive the
 * exact persist payload, and the preview endpoint calls it to render
 * the diff. One math path, no drift.
 */

import type { LineItemDepartment, LineItemType, RateType, DiscountScope, DiscountType } from '@prisma/client'
import { BILLING_RULES, calendarDays, computeBillableDays, computeLineTotal } from '@/lib/orders/billing'
import { computeOrderTotals, type DiscountForTotals, type TotalsBreakdown } from '@/lib/orders/discountedTotals'

export type CustomItemAction = 'shift' | 'keep'

export interface PreviewLineItem {
  id: string
  description: string
  department: LineItemDepartment
  type: LineItemType
  rateType: RateType
  rate: number
  quantity: number
  /** True iff both startDate and endDate are null. */
  inheritsDates: boolean
  startDate: Date | null
  endDate: Date | null
  pickupDate: Date
  returnDate: Date
  billableDays: number
  lineTotal: number
}

export interface ProjectedLineItem extends PreviewLineItem {
  /** Action taken for this item during projection. */
  classification: 'inherited' | 'custom_shifted' | 'custom_kept'
  /** Old → new billable day delta. */
  billableDaysOld: number
  billableDaysNew: number
  /** Old → new lineTotal delta. */
  lineTotalOld: number
  lineTotalNew: number
}

export interface PushDatesPreview {
  currentRange: { startDate: Date; endDate: Date; calendarDays: number }
  newRange: { startDate: Date; endDate: Date; calendarDays: number }
  /** offsetDays = newStart - currentStart (in whole days). */
  offsetDays: number
  projectedItems: ProjectedLineItem[]
  currentTotals: TotalsBreakdown
  projectedTotals: TotalsBreakdown
  delta: { subtotal: number; tax: number; total: number }
}

function dayMs(): number {
  return 86_400_000
}

function shiftDate(d: Date, deltaMs: number): Date {
  return new Date(d.getTime() + deltaMs)
}

function deriveBillableDays(department: LineItemDepartment, calDays: number): number {
  const rules = BILLING_RULES[department]
  if (rules.model === 'PURCHASE') return 1 // EXPENDABLES: bill once, days unused
  if (rules.model === 'PERCENT_DISCOUNT') return calDays
  // CAP_PER_WEEK
  return computeBillableDays(calDays, rules.cap)
}

export function computePushDatesPreview(args: {
  currentStartDate: Date
  currentEndDate: Date
  newStartDate: Date
  newEndDate: Date
  items: PreviewLineItem[]
  customItemActions: Record<string, CustomItemAction>
  discounts: DiscountForTotals[]
  taxRate: number
}): PushDatesPreview {
  const {
    currentStartDate, currentEndDate, newStartDate, newEndDate,
    items, customItemActions, discounts, taxRate,
  } = args

  const currentCal = calendarDays(currentStartDate, currentEndDate)
  const newCal = calendarDays(newStartDate, newEndDate)
  const offsetMs = newStartDate.getTime() - currentStartDate.getTime()
  const offsetDays = Math.round(offsetMs / dayMs())

  const projectedItems: ProjectedLineItem[] = items.map((it) => {
    if (it.inheritsDates) {
      const newBillable = deriveBillableDays(it.department, newCal)
      const newLineTotal = computeLineTotal({
        quantity: it.quantity,
        rate: it.rate,
        billableDays: newBillable,
        rateType: it.rateType,
        department: it.department,
      })
      return {
        ...it,
        classification: 'inherited',
        startDate: null,
        endDate: null,
        pickupDate: newStartDate,
        returnDate: newEndDate,
        billableDays: newBillable,
        lineTotal: newLineTotal,
        billableDaysOld: it.billableDays,
        billableDaysNew: newBillable,
        lineTotalOld: it.lineTotal,
        lineTotalNew: newLineTotal,
      }
    }

    const action = customItemActions[it.id] ?? 'keep'
    if (action === 'keep') {
      return {
        ...it,
        classification: 'custom_kept',
        billableDaysOld: it.billableDays,
        billableDaysNew: it.billableDays,
        lineTotalOld: it.lineTotal,
        lineTotalNew: it.lineTotal,
      }
    }

    // Custom + shift: move all four date columns by the offset.
    const startDate = it.startDate ? shiftDate(it.startDate, offsetMs) : shiftDate(it.pickupDate, offsetMs)
    const endDate = it.endDate ? shiftDate(it.endDate, offsetMs) : shiftDate(it.returnDate, offsetMs)
    const pickupDate = shiftDate(it.pickupDate, offsetMs)
    const returnDate = shiftDate(it.returnDate, offsetMs)
    const newCustomCal = calendarDays(pickupDate, returnDate)
    const newBillable = deriveBillableDays(it.department, newCustomCal)
    const newLineTotal = computeLineTotal({
      quantity: it.quantity,
      rate: it.rate,
      billableDays: newBillable,
      rateType: it.rateType,
      department: it.department,
    })
    return {
      ...it,
      classification: 'custom_shifted',
      startDate, endDate, pickupDate, returnDate,
      billableDays: newBillable,
      lineTotal: newLineTotal,
      billableDaysOld: it.billableDays,
      billableDaysNew: newBillable,
      lineTotalOld: it.lineTotal,
      lineTotalNew: newLineTotal,
    }
  })

  const currentTotals = computeOrderTotals({
    lines: items.map((i) => ({
      department: i.department,
      type: i.type,
      lineTotal: i.lineTotal,
    })),
    discounts,
    taxRate,
  })
  const projectedTotals = computeOrderTotals({
    lines: projectedItems.map((i) => ({
      department: i.department,
      type: i.type,
      lineTotal: i.lineTotal,
    })),
    discounts,
    taxRate,
  })

  return {
    currentRange: { startDate: currentStartDate, endDate: currentEndDate, calendarDays: currentCal },
    newRange: { startDate: newStartDate, endDate: newEndDate, calendarDays: newCal },
    offsetDays,
    projectedItems,
    currentTotals,
    projectedTotals,
    delta: {
      subtotal: round2(projectedTotals.rawSubtotal - currentTotals.rawSubtotal),
      tax: round2(projectedTotals.taxAmount - currentTotals.taxAmount),
      total: round2(projectedTotals.total - currentTotals.total),
    },
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Type re-exports so the API route + UI share the same exact shape
 * without importing from /lib in client code.
 */
export type { DiscountScope, DiscountType }
