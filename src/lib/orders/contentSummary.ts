/**
 * "What is actually in this order", in one line.
 *
 * An order row that reads `S260914-006 · APPROVED · 1 line` says nothing
 * about the rental — a rep scanning a job's orders had to expand each one
 * to find out which is the truck and which is the radio package (Wes
 * 2026-09-14: "the orders should not just be numbers, but ideally give
 * some info on what is in the order: Vehicles, Art Truck, Pro Supplies").
 *
 * The shape of the answer follows how the fleet is sold:
 *
 *  - VEHICLES and STAGES lines ARE the thing being rented, so they are
 *    named individually ("SuperCube Truck ×2"). "Vehicles" alone is
 *    useless on a page where nearly every order has one.
 *  - Everything else is a commodity department — 40 folding chairs and
 *    20 shoe covers are "Pro Supplies", not a list. Those collapse to the
 *    department label, in `LINE_ITEM_DEPARTMENT_ORDER`.
 *  - Kit pieces / ancillaries (`parentLineItemId`) and standalone FEE
 *    lines (LCDW, delivery) are not scope — they ride along with it, and
 *    an order summarised as "Limited Collision Damage Waiver" is a lie.
 *    A fees-only order still says "Fees" rather than nothing.
 *
 * Department labels come from the ONE ordering the quote PDF and the
 * order page already share, so the summary can't drift from either.
 */
import {
  LINE_ITEM_DEPARTMENT_ORDER,
  LINE_ITEM_DEPARTMENT_LABELS,
  type LineItemDepartmentKey,
} from './lineItemDepartments'

/** Structural on purpose — the job page's OrderLineItem, the order
 *  page's LineItem and a raw Prisma select all satisfy it. */
export type SummarizableLine = {
  description: string
  department: string
  type?: string | null
  quantity?: number | null
  parentLineItemId?: string | null
}

/** Departments whose lines are named unit-by-unit rather than collapsed. */
const NAMED_DEPARTMENTS = new Set<string>(['VEHICLES', 'STAGES'])

const DEFAULT_MAX_NAMED = 3

export function orderContentSummary(
  lines: SummarizableLine[],
  opts: { maxNamed?: number } = {},
): string | null {
  const maxNamed = opts.maxNamed ?? DEFAULT_MAX_NAMED
  // Named units, deduped by description in the order they appear, with
  // quantities summed: two SuperCube lines on one order is "×2", which
  // is also how the /jobs rail's gear line reads.
  const named = new Map<string, number>()
  const departments = new Set<string>()
  let sawFee = false

  for (const li of lines) {
    if (li.parentLineItemId) continue // rides under its parent
    if (li.type === 'FEE') { sawFee = true; continue }
    const qty = Math.max(1, Number(li.quantity ?? 1) || 1)
    if (NAMED_DEPARTMENTS.has(li.department)) {
      const label = (li.description || '').trim()
      if (!label) { departments.add(li.department); continue }
      named.set(label, (named.get(label) ?? 0) + qty)
    } else {
      departments.add(li.department)
    }
  }

  const parts: string[] = []
  const namedList = [...named.entries()]
  for (const [label, qty] of namedList.slice(0, maxNamed)) {
    parts.push(qty > 1 ? `${label} ×${qty}` : label)
  }
  const overflow = namedList.length - Math.min(namedList.length, maxNamed)
  if (overflow > 0) parts.push(`+${overflow} more`)

  // Canonical department order first, then anything unrecognised (a new
  // enum value shows up under its raw key rather than vanishing).
  for (const dept of LINE_ITEM_DEPARTMENT_ORDER) {
    if (departments.has(dept)) {
      parts.push(LINE_ITEM_DEPARTMENT_LABELS[dept as LineItemDepartmentKey])
      departments.delete(dept)
    }
  }
  for (const dept of departments) parts.push(dept)

  if (parts.length === 0) return sawFee ? 'Fees' : null
  return parts.join(' · ')
}

/** How many reserved units get named before the line says "+N more". */
const DEFAULT_MAX_UNITS = 4

/**
 * The same line, with the UNITS actually reserved for this order named.
 *
 * "SuperCube Truck ×2 · Pro Supplies" answers what was sold; the yard
 * reading a morning brief wants to know which trucks leave (Wes
 * 2026-09-18, on the Going out list: "let's name the vehicles and or
 * order type"). A class name cannot answer that and a unit name cannot
 * answer the first, so the line carries both.
 *
 * The caller must pass units taken from `BookingAssignment.orderId` —
 * bookings are JOB-level and shared by sibling orders, so reading units
 * off the order's booking would name a truck going out on a different
 * order. An order whose assignments carry no order id (legacy rows,
 * holds placed before the order existed) names no unit rather than
 * guessing.
 */
export function orderContentsLine(
  lines: SummarizableLine[],
  unitNames: readonly string[] = [],
  opts: { maxNamed?: number; maxUnits?: number } = {},
): string | null {
  const summary = orderContentSummary(lines, opts)
  const maxUnits = opts.maxUnits ?? DEFAULT_MAX_UNITS
  const units = [...new Set(unitNames.map((u) => (u || '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  )
  if (units.length === 0) return summary

  const shown = units.slice(0, maxUnits)
  const overflow = units.length - shown.length
  const named = shown.join(', ') + (overflow > 0 ? ` +${overflow} more` : '')
  return summary ? `${summary} — ${named}` : named
}
