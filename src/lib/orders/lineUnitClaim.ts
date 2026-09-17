/**
 * "It's on reservations but the order line says no unit."
 *
 * Wes 2026-09-17, on Index Films: "we have two cube trucks on two orders
 * in that job — both cube trucks on the order says there is not a unit
 * assigned even though it's on reservations."
 *
 * Both readouts were right about different things. The booking is
 * JOB-level and shared by every order on the job (holdOnQuoteSend), so
 * two orders quoting a Cube Truck raise ONE BookingItem of quantity 2,
 * and the board fills it with two trucks. Which truck belongs to which
 * order is then a question only a person can answer — and
 * `assignUnitToBookingItem` deliberately refuses to guess:
 *
 *     const attachOrderId =
 *       requestedOrderId ?? inheritedOrderId ??
 *       (candidateOrders.length === 1 ? candidateOrders[0].id : null)
 *
 * With ONE live order the unit is stamped and the order line prints it.
 * With TWO, `attachOrderId` is null, the picker's order box defaults to
 * "Don't attach to an order yet", and nothing carries `orderId` or
 * `orderLineItemId` at all. `liveUnitsForLine` then finds neither a line
 * stamp nor an order match and reports NOTHING — so both lines read
 * "Held · no unit" while the header card above them lists both trucks
 * under "Reserved units". The trucks were never missing; no one had said
 * which line they were for.
 *
 * This module is the missing third answer. `mine` reproduces
 * `liveUnitsForLine` exactly — what the line already owns, stamp first
 * and the legacy exact-date fallback second — and `unclaimed` is the rest
 * of the hold that NO line and NO sibling order has claimed, which is
 * what the row should offer instead of saying nothing is reserved.
 *
 * It claims nothing by itself. With two unattached trucks and two lines
 * wanting one each, the machine genuinely cannot tell them apart, and a
 * wrong stamp prints the wrong unit on a quote and releases the wrong
 * truck later (see lineUnits.ts). So the rule OFFERS; the rep attaches.
 *
 * Pure — no prisma. Dates come in as ISO strings on the order page and as
 * Date objects on the server, so every comparison goes through `day()`.
 *
 * Run: npm run test:line-unit-claim
 */

/** Live means the unit is still standing on the hold. Same pair
 *  `lineUnits.ts` releases by — a RETURNED or SWAPPED row is history. */
export const LIVE_UNIT_STATUSES = ['ASSIGNED', 'CHECKED_OUT'] as const

export type DayLike = string | Date | null | undefined

/** The fields of a BookingAssignment this rule reads. */
export interface HoldUnitRow {
  id: string
  status: string
  startDate: DayLike
  endDate: DayLike
  /** Which ORDER the truck goes out on. Null = nobody said. */
  orderId: string | null
  /** Which LINE of it. Null = bound from the board, or before 2026-09-16.
   *  Optional because the order page's row type declares it so. */
  orderLineItemId?: string | null
}

/** A vehicle line competing for the same hold. */
export interface ClaimLine {
  id: string
  quantity: number
  pickupDate: DayLike
  returnDate: DayLike
}

export interface HoldUnitSplit<T> {
  /** The line's own trucks — exactly what `liveUnitsForLine` returns. */
  mine: T[]
  /** True when `mine` came from the line stamp rather than the date fallback. */
  stamped: boolean
  /**
   * Reserved on this hold, claimed by no line and no sibling order, so
   * this line may attach one. Empty means the hold really is short a
   * truck and "Held · no unit" is the honest thing to say.
   */
  unclaimed: T[]
}

/** Calendar day, UTC — these are @db.Date values and reading them in
 *  Pacific prints the day before (src/lib/dates/calendarDate.ts). */
export function day(v: DayLike): string | null {
  if (!v) return null
  if (typeof v === 'string') return v.slice(0, 10)
  const t = v.getTime()
  return Number.isNaN(t) ? null : v.toISOString().slice(0, 10)
}

/** Does this unit stand on exactly the line's block? The fallback match
 *  is EXACT, never overlap: a 9/28→9/30 van overlaps the 9/29→9/30 block
 *  and is not that block's truck (assignWindow.ts). */
export function coversLine(unit: HoldUnitRow, line: ClaimLine): boolean {
  const s = day(line.pickupDate)
  const e = day(line.returnDate)
  if (!s || !e) return false
  return day(unit.startDate) === s && day(unit.endDate) === e
}

/** A truck whose days do not match the line it is printed on — worth
 *  saying out loud on the row, because it is the other way an order and
 *  a reservation drift apart (the dates moved and nothing followed). */
export function daysDiffer(unit: HoldUnitRow, line: ClaimLine): boolean {
  const s = day(line.pickupDate)
  const e = day(line.returnDate)
  if (!s || !e) return false
  return !coversLine(unit, line)
}

export function isLive(unit: HoldUnitRow): boolean {
  return (LIVE_UNIT_STATUSES as readonly string[]).includes(unit.status)
}

/**
 * Split a hold's units into this line's and the ones going spare.
 *
 * `siblingLines` are the OTHER lines of the SAME order on the SAME hold.
 * They matter only for the legacy fallback: an unstamped truck sitting on
 * a sibling's block is that sibling's, not spare. Pass them in the order
 * the rows are rendered so the per-line quantity caps line up with what
 * each row shows.
 */
export function splitHoldUnits<T extends HoldUnitRow>(args: {
  assignments: T[]
  orderId: string
  line: ClaimLine
  siblingLines?: ClaimLine[]
}): HoldUnitSplit<T> {
  const live = args.assignments.filter(isLive)
  const cap = Math.max(0, Math.floor(args.line.quantity || 0))

  const stampedHere = live.filter((a) => a.orderLineItemId === args.line.id)
  const legacyHere = live
    .filter((a) => a.orderId === args.orderId && !a.orderLineItemId && coversLine(a, args.line))
    .slice(0, cap)
  const stamped = stampedHere.length > 0
  const mine = stamped ? stampedHere : legacyHere
  const mineIds = new Set(mine.map((a) => a.id))

  // A sibling row's own legacy units, under the same cap it renders with.
  const siblingLegacy = new Set<string>()
  for (const sib of args.siblingLines ?? []) {
    if (sib.id === args.line.id) continue
    if (live.some((a) => a.orderLineItemId === sib.id)) continue // sibling is stamped; its legacy match is moot
    live
      .filter((a) => a.orderId === args.orderId && !a.orderLineItemId && coversLine(a, sib))
      .slice(0, Math.max(0, Math.floor(sib.quantity || 0)))
      .forEach((a) => siblingLegacy.add(a.id))
  }

  const unclaimed = live.filter((a) => {
    if (mineIds.has(a.id)) return false
    // Somebody's line already owns it.
    if (a.orderLineItemId) return false
    if (siblingLegacy.has(a.id)) return false
    // Going out on a DIFFERENT order — that order's truck, not ours.
    if (a.orderId && a.orderId !== args.orderId) return false
    return true
  })

  return { mine, stamped, unclaimed }
}
