/**
 * WHY a truck that is plainly on the hold does not show on the order line.
 *
 * Wes 2026-09-19: "Cargo 35 is a reservation for this job, but the order
 * says Equipment—cargo (not assigned) when it's the same vehicle."
 *
 * TWO RULES READ THE SAME ROW AND ANSWER DIFFERENTLY, which is what makes
 * this a dead end rather than a nuisance:
 *
 *   · CAPACITY (`blockCapacity` / `coverageOfBlock`, assignWindow.ts) counts
 *     an assignment by its DATES alone — whose order it is on, and which
 *     line it is stamped with, are not part of the question. So the block
 *     reads FULL and the unit picker offers a swap, not an assign.
 *   · The LINE'S READOUT (`unitsForLine` on the order page, mirrored by
 *     `liveUnitsForLine` in lineUnits.ts) claims a unit only when it is
 *     stamped with THIS line, or is unstamped AND carries THIS order's id
 *     AND covers the line's block exactly.
 *
 * An assignment can satisfy the first and fail the second, and then the
 * line says "Held · no unit" while the picker says the block is full.
 * Neither screen is wrong about its own question; together they leave a
 * real reservation invisible with no obvious way to claim it.
 *
 * THE COMMONEST WAY IN IS `orderId: null`, AND IT IS DELIBERATE. `assignUnit`
 * attaches an order only when the caller named one, a swap inherits one, or
 * `soleOrderCoveringHold` finds EXACTLY ONE order on the job whose days
 * touch the hold. A job carrying two overlapping orders is an ambiguity the
 * agent resolves, not the server (Oliver, 2026-09-18 — a wrong stamp had put
 * a van on paperwork the yard had closed three days earlier). So the board
 * writes an assignment belonging to no order, and every line on the job then
 * fails the `orderId` half of the claim.
 *
 * This module is the READ side only: it never changes a claim, it says why
 * there isn't one. Deciding a truck belongs to a line is a person's call,
 * and `canTieToLine` marks the ONE case where that call is unambiguous.
 *
 * PURE — no prisma, no env. The order page is a client component.
 */

/** Why this live assignment is not among the line's units. */
export type ClaimBlocker =
  /** Reserved for a different line of this order. */
  | 'other-line'
  /** Going out on another order on the same job. */
  | 'other-order'
  /** On the hold, attached to no order at all — the board's ambiguous case. */
  | 'unattached'
  /** This order's, unstamped, but covering different days than the line. */
  | 'other-dates'
  /** Nothing is wrong with it — the line simply asked for fewer units. */
  | 'over-quantity'

export interface ClaimAssignment {
  orderId: string | null
  orderLineItemId?: string | null
  /** ISO; only the calendar day is compared, as the claim rule compares it. */
  startDate: string
  endDate: string
  order?: { orderNumber: string } | null
  asset: { unitName: string }
}

export interface ClaimLine {
  id: string
  orderId: string
  pickupDate: string
  returnDate: string
}

const day = (v: string): string => v.slice(0, 10)

/**
 * The blocker, in the SAME ORDER the claim itself is decided — a stamp
 * settles the question before dates or orders are looked at, exactly as
 * `unitsForLine` short-circuits on `stamped.length > 0`. Returns null when
 * nothing blocks it, which for an assignment the line did not take means
 * the line's quantity was already met.
 */
export function claimBlockerFor(a: ClaimAssignment, line: ClaimLine): ClaimBlocker {
  const stamp = a.orderLineItemId ?? null
  if (stamp) return stamp === line.id ? 'over-quantity' : 'other-line'
  if (a.orderId !== line.orderId) return a.orderId === null ? 'unattached' : 'other-order'
  if (day(a.startDate) !== day(line.pickupDate) || day(a.endDate) !== day(line.returnDate)) return 'other-dates'
  return 'over-quantity'
}

/**
 * Would attaching THIS order to the assignment make the line claim it?
 *
 * True only for the unambiguous case: nothing is stamped on it, it belongs
 * to no order, and it already covers this line's block day for day. Then
 * `PATCH /api/scheduling/assignments/[id]/order` is the whole fix and the
 * line picks the truck up on the next read.
 *
 * Deliberately FALSE for a unit on a sibling order, and for one whose days
 * differ. Taking a truck off another order's paperwork, or moving its days,
 * is a decision with a yard consequence — it gets a sentence naming what is
 * in the way, never a one-tap button.
 */
export function canTieToLine(a: ClaimAssignment, line: ClaimLine): boolean {
  return claimBlockerFor(a, line) === 'unattached'
    && day(a.startDate) === day(line.pickupDate)
    && day(a.endDate) === day(line.returnDate)
}

/** One phrase for the chip, naming what is in the way in the yard's terms. */
export function claimBlockerWords(b: ClaimBlocker, a: ClaimAssignment): string {
  switch (b) {
    case 'other-line':
      return 'reserved for another line on this order'
    case 'other-order':
      return a.order?.orderNumber ? `going out on ${a.order.orderNumber}` : 'going out on another order'
    case 'unattached':
      return 'on this job’s hold, not tied to an order yet'
    case 'other-dates':
      return `reserved for ${day(a.startDate)} – ${day(a.endDate)}`
    case 'over-quantity':
      return 'already counted against this line'
  }
}
