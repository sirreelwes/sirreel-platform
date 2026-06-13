import type { DiscountScope, DiscountType, LineItemDepartment, LineItemType } from '@prisma/client'

/**
 * Single source of truth for "what does this order add up to, with
 * discounts applied?" — consumed by recalcOrderTotals (server-side
 * persist), QuoteDocument PDF, InvoiceDocument generator, and the
 * order detail GET API.
 *
 * Why this lives in one place: the prior architecture had every render
 * path inline its own subtotal/tax math (recalcOrderTotals, the quote
 * PDF body, the RENTAL invoice generator). When discounts arrive,
 * inlining the math four ways guarantees they ship in three places at
 * three different rounding rules. This util collapses that into one.
 *
 * Math:
 *   per department:
 *     deptLineSubtotal = Σ non-DISCOUNT-type lineTotal in that dept
 *     deptDiscount     = PERCENT ? deptLineSubtotal * value/100
 *                                 : value
 *     deptDiscount     = clamp(deptDiscount, 0, deptLineSubtotal)
 *
 *   rawSubtotal        = Σ ALL line items (positive lines + negative
 *                        legacy DISCOUNT-type rows already reduce it)
 *   deptDiscountSum    = Σ deptDiscount
 *   discountedSubtotal = rawSubtotal - deptDiscountSum
 *
 *   orderDiscount      = PERCENT ? discountedSubtotal * value/100
 *                                 : value
 *   orderDiscount      = clamp(orderDiscount, 0, discountedSubtotal)
 *
 *   preTax             = discountedSubtotal - orderDiscount
 *   taxAmount          = preTax * taxRate
 *   total              = preTax + taxAmount
 *
 * Sanity contract — when there are NO OrderDiscount rows, this util
 * returns byte-identical subtotal/taxAmount/total to the legacy
 * `subtotal × taxRate` math. Verified by computeOrderTotalsSanityCheck()
 * below. No regression on the existing book of orders.
 *
 * Money-precision contract: everything is rounded to 2 decimals at
 * the boundary (per-discount, per-section, taxAmount, total) so the
 * persisted Decimal columns store cent-clean values and PDF math
 * doesn't drift by 0.005 from one renderer to the next.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100
const clampNonNeg = (n: number, max: number): number => Math.max(0, Math.min(n, max))

export interface LineForTotals {
  department: LineItemDepartment
  type: LineItemType
  lineTotal: number | string // Decimal coming back from Prisma may be string
}

export interface DiscountForTotals {
  id?: string
  scope: DiscountScope
  departmentKey: LineItemDepartment | null
  type: DiscountType
  value: number | string
  label: string
}

export interface DepartmentBreakdown {
  department: LineItemDepartment
  /** Sum of non-DISCOUNT-type line totals in this department. Matches
   *  what the quote PDF shows as the "PRO_SUPPLIES Subtotal" row. */
  lineSubtotal: number
  /** Applied discount amount, positive, already clamped to lineSubtotal. */
  discount: number
  /** Label of the applied DEPARTMENT-scope discount, or null when none. */
  discountLabel: string | null
  /** lineSubtotal - discount. */
  netSubtotal: number
}

export interface TotalsBreakdown {
  /** Σ all OrderLineItem.lineTotal (incl legacy DISCOUNT rows, which are
   *  already negative). What the old recalcOrderTotals returned as
   *  "subtotal". Persisted on Order.subtotal. */
  rawSubtotal: number
  /** Per-department roll-up — drives the quote PDF section discount lines. */
  byDepartment: DepartmentBreakdown[]
  /** Σ byDepartment.discount. */
  departmentDiscountSum: number
  /** rawSubtotal - departmentDiscountSum. Order discount clamps against this. */
  discountedSubtotal: number
  /** Applied ORDER-scope discount, positive, clamped. */
  orderDiscount: number
  /** Label of the applied ORDER-scope discount, or null when none. */
  orderDiscountLabel: string | null
  /** True iff the ORDER discount is a FLAT_TOTAL whose target is at or
   *  above the current discountedSubtotal — discount clamped to 0 so the
   *  order is never silently marked up. UI surfaces an amber warning. */
  flatTotalClamped: boolean
  /** For FLAT_TOTAL: the target grand total the user entered (echoed for
   *  the UI warning). Null for PERCENT / FIXED. */
  flatTotalTarget: number | null
  /** discountedSubtotal - orderDiscount. The base tax is computed on. */
  preTaxSubtotal: number
  /** Echoed for downstream renderers; same value the caller passed in. */
  taxRate: number
  /** preTaxSubtotal × taxRate. Persisted on Order.taxAmount. */
  taxAmount: number
  /** preTaxSubtotal + taxAmount. Persisted on Order.total. */
  total: number
}

function numberOf(v: number | string): number {
  return typeof v === 'string' ? Number(v) : v
}

/**
 * Compute the breakdown. Pure — no I/O, no Prisma calls. Callers fetch
 * lines + discounts + taxRate first and pass them in.
 */
export function computeOrderTotals(args: {
  lines: LineForTotals[]
  discounts: DiscountForTotals[]
  taxRate: number
}): TotalsBreakdown {
  const { lines, discounts, taxRate } = args

  // ── Raw subtotal: every line, including legacy DISCOUNT (which is
  //    already a negative lineTotal). Matches the legacy math.
  const rawSubtotal = round2(lines.reduce((sum, l) => sum + numberOf(l.lineTotal), 0))

  // ── Per-department lineSubtotals: exclude legacy DISCOUNT-type rows
  //    so a department discount clamps against the same number the PDF
  //    shows as "<DEPT> Subtotal". Legacy DISCOUNT rows still feed
  //    rawSubtotal above, just not the per-dept clamp basis.
  const deptMap = new Map<LineItemDepartment, number>()
  for (const l of lines) {
    if (l.type === 'DISCOUNT') continue
    const prev = deptMap.get(l.department) ?? 0
    deptMap.set(l.department, prev + numberOf(l.lineTotal))
  }

  // ── Index discounts by scope. App-layer contract guarantees at most
  //    one ORDER row + one row per departmentKey, but we tolerate dups
  //    here by taking the most recently created (fallback: first one).
  const deptDiscounts = new Map<LineItemDepartment, DiscountForTotals>()
  let orderDiscountRow: DiscountForTotals | null = null
  for (const d of discounts) {
    if (d.scope === 'ORDER') {
      if (!orderDiscountRow) orderDiscountRow = d
    } else if (d.scope === 'DEPARTMENT' && d.departmentKey) {
      if (!deptDiscounts.has(d.departmentKey)) deptDiscounts.set(d.departmentKey, d)
    }
  }

  // ── Department breakdown. Include every dept that has either lines
  //    OR a discount (so a misconfigured discount targeting a dept with
  //    no lines still surfaces with discount=0 and the API/UI can warn).
  const allDepts = new Set<LineItemDepartment>([...deptMap.keys(), ...deptDiscounts.keys()])
  const byDepartment: DepartmentBreakdown[] = []
  let departmentDiscountSum = 0
  for (const dept of allDepts) {
    const lineSubtotal = round2(deptMap.get(dept) ?? 0)
    const d = deptDiscounts.get(dept) ?? null
    let discount = 0
    if (d) {
      const v = numberOf(d.value)
      discount = d.type === 'PERCENT' ? lineSubtotal * (v / 100) : v
      discount = round2(clampNonNeg(discount, lineSubtotal))
    }
    departmentDiscountSum += discount
    byDepartment.push({
      department: dept,
      lineSubtotal,
      discount,
      discountLabel: d?.label ?? null,
      netSubtotal: round2(lineSubtotal - discount),
    })
  }
  departmentDiscountSum = round2(departmentDiscountSum)

  // ── Order-scope discount clamps against the post-dept subtotal.
  const discountedSubtotal = round2(rawSubtotal - departmentDiscountSum)
  let orderDiscount = 0
  let orderDiscountLabel: string | null = null
  let flatTotalClamped = false
  let flatTotalTarget: number | null = null
  if (orderDiscountRow) {
    const v = numberOf(orderDiscountRow.value)
    if (orderDiscountRow.type === 'FLAT_TOTAL') {
      // FLAT_TOTAL — `value` is the TARGET GRAND TOTAL the user entered.
      // Derive the discount live so the order total stays pinned to the
      // target as lines / dates shift. Inverse of the post-discount math:
      //   total      = (discountedSubtotal − orderDiscount) × (1 + taxRate)
      //   →  orderDiscount = discountedSubtotal − target / (1 + taxRate)
      // No persisted dollar amount — `value` is the target.
      flatTotalTarget = round2(v)
      const preTaxFromTarget = v / (1 + taxRate)
      const rawDiscount = round2(discountedSubtotal - preTaxFromTarget)
      // CLAMP RULE — margin guardrail. If subtotal dropped below the
      // flat target, the implied discount would go negative (a silent
      // markup through the discount field). Clamp at $0 and surface
      // flatTotalClamped so the UI can warn. Flip this single
      // conditional if policy ever changes to "allow markup".
      if (rawDiscount < 0) {
        orderDiscount = 0
        flatTotalClamped = true
      } else {
        orderDiscount = round2(clampNonNeg(rawDiscount, Math.max(0, discountedSubtotal)))
      }
    } else {
      const calc = orderDiscountRow.type === 'PERCENT'
        ? discountedSubtotal * (v / 100)
        : v
      orderDiscount = round2(clampNonNeg(calc, Math.max(0, discountedSubtotal)))
    }
    orderDiscountLabel = orderDiscountRow.label
  }

  const preTaxSubtotal = round2(discountedSubtotal - orderDiscount)
  const taxAmount = round2(preTaxSubtotal * taxRate)
  const total = round2(preTaxSubtotal + taxAmount)

  return {
    rawSubtotal,
    byDepartment,
    departmentDiscountSum,
    discountedSubtotal,
    orderDiscount,
    orderDiscountLabel,
    flatTotalClamped,
    flatTotalTarget,
    preTaxSubtotal,
    taxRate,
    taxAmount,
    total,
  }
}

/**
 * Convert a flat-total target into the equivalent FIXED-value
 * ORDER-scope discount. Inverse of the math above:
 *
 *   target = (discountedSubtotal - orderDiscount) * (1 + taxRate)
 *   →  orderDiscount = discountedSubtotal - target / (1 + taxRate)
 *
 * Returns the discount amount rounded to 2 decimals. Negative result
 * means the target is ABOVE the current discounted total (the UI
 * should reject before calling). Caller is responsible for the
 * clamp / reject guard rails — this helper does the math only.
 */
export function flatTotalToOrderDiscount(args: {
  discountedSubtotal: number
  target: number
  taxRate: number
}): number {
  const { discountedSubtotal, target, taxRate } = args
  const preTaxFromTarget = target / (1 + taxRate)
  return round2(discountedSubtotal - preTaxFromTarget)
}

/**
 * Convert a flat-total target into the equivalent FIXED-value
 * DEPARTMENT-scope discount. Department subtotals are pre-tax (tax
 * is applied once at the order grain), so the math is just:
 *
 *   target = deptSubtotal - deptDiscount
 *   → deptDiscount = deptSubtotal - target
 *
 * No tax factor. Same not-pinned semantics as the order-scope flat
 * total — adding items to this department later moves its subtotal
 * visibly. Caller is responsible for the clamp / reject guard rails
 * (target must be ≥ 0 and < deptSubtotal); this helper does the math
 * only and may return a negative value if the target is above
 * deptSubtotal.
 */
export function flatTotalToDepartmentDiscount(args: {
  deptSubtotal: number
  target: number
}): number {
  return round2(args.deptSubtotal - args.target)
}

/**
 * Self-check called by tests + the integration boundary: with ZERO
 * discounts, computeOrderTotals must match the legacy `subtotal × rate`
 * math exactly. If this ever returns false, the totals are about to
 * drift on the existing book of orders and the caller should bail.
 */
export function zeroDiscountSanityHolds(args: {
  lines: LineForTotals[]
  taxRate: number
}): boolean {
  const legacySubtotal = round2(args.lines.reduce((s, l) => s + numberOf(l.lineTotal), 0))
  const legacyTax = round2(legacySubtotal * args.taxRate)
  const legacyTotal = round2(legacySubtotal + legacyTax)

  const fresh = computeOrderTotals({ lines: args.lines, discounts: [], taxRate: args.taxRate })
  return (
    fresh.rawSubtotal === legacySubtotal &&
    fresh.taxAmount === legacyTax &&
    fresh.total === legacyTotal &&
    fresh.discountedSubtotal === legacySubtotal &&
    fresh.preTaxSubtotal === legacySubtotal &&
    fresh.orderDiscount === 0 &&
    fresh.departmentDiscountSum === 0
  )
}
