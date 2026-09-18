/**
 * "Is there enough of this?" — on-hand vs. what is already spoken for,
 * for the warehouse gear on an order's line items.
 *
 * This is the RentalWorks behaviour the guys asked for back: a small
 * number beside the quantity on every line, red the moment the line
 * asks for more than the shelf can cover. RW had it; HQ has had agents
 * quoting 40 ratchet straps with no way to know we own 24.
 *
 * ── What counts as stock ────────────────────────────────────────────
 * `InventoryItem.qtyOwned` is HQ's count on hand for QUANTITY-tracked
 * rows (warehouse gear). It is NOT universally populated: measured
 * 2026-09-18, 1,185 of 1,745 active catalog rows sit at 0, and 217 of
 * the 800 catalog-bound order lines in the book point at one of them —
 * Straps/Ratchet (47 lines), Power Strip (14), Trash Liners, Director's
 * Chairs. SirReel obviously stocks all of those; the count was simply
 * never entered.
 *
 * So **0 means "not counted", not "we have none"**, and `counted`
 * carries that distinction to the UI. A zero row renders NO number
 * rather than a red one — a red flag on a quarter of every order's
 * lines is noise the crew would learn to ignore inside a week, and
 * it would be wrong. When someone counts the shelf and enters a
 * qtyOwned, that item starts answering the question. Nothing else
 * needs to change.
 *
 * UNIT_TRACKED rows (the 17 vehicle/stage categories) are deliberately
 * NOT answered here. Their truth is the scheduler — serviceable Assets
 * minus BookingAssignments, `src/lib/scheduling/availability.ts` — and
 * an order's own demand for them lives in a BookingItem hold, not in
 * the line's quantity. Netting a vehicle line against a hold the same
 * line created would paint every booked vehicle red. Those rows come
 * back `mode: 'UNIT_TRACKED'` with no numbers, and the order page's
 * existing hold / assign-units UI keeps telling that story.
 *
 * ── What counts against it ──────────────────────────────────────────
 * `committed` is the quantity on OTHER orders that are firm (APPROVED
 * through ON_JOB) whose line dates overlap the asked-for window.
 * `quoted` is the same for orders still DRAFT / QUOTE_SENT — pressure
 * an agent should see, but not a claim on the shelf, so it is reported
 * separately and never subtracted.
 *
 * A line that a partner fulfils does not touch our shelf: each line's
 * demand is reduced by the quantity its live SubRentals cover, so
 * sub-renting 5 of 8 releases 5 back to everyone else's availability.
 *
 * Both `Order.status` and the effective per-line window are read the
 * way the rest of the app reads them — `startDate ?? pickupDate`,
 * inclusive on both ends (see project memory: calendar days inclusive).
 */

import { prisma } from '@/lib/prisma'
import type { OrderStatus, SubRentalStatus } from '@prisma/client'

/**
 * Orders whose lines hold real stock. DRAFT / QUOTE_SENT are pressure,
 * not a claim (see STOCK_QUOTED_STATUSES); everything from RETURNED
 * onward is gear that is back on the shelf or already billed.
 */
export const STOCK_COMMITTED_STATUSES: OrderStatus[] = [
  'APPROVED',
  'BOOKED',
  'LOADED_READY',
  'ON_JOB',
]

/** Not yet a claim on the shelf — surfaced in the tooltip only. */
export const STOCK_QUOTED_STATUSES: OrderStatus[] = ['DRAFT', 'QUOTE_SENT']

/**
 * A sub-rental that takes the line off our shelf. ESTIMATED is excluded
 * on purpose — it is a pitch to the vendor, nothing is held (see the
 * enum's own doc comment). CANCELLED obviously covers nothing.
 */
const COVERING_SUB_RENTAL_STATUSES: SubRentalStatus[] = [
  'REQUESTED',
  'CONFIRMED',
  'PICKED_UP',
  'ON_RENT',
  'RETURNED',
]

export interface ItemStock {
  inventoryItemId: string
  mode: 'QUANTITY' | 'UNIT_TRACKED'
  /** qtyOwned. Meaningless when `counted` is false. */
  onHand: number
  /** False when nobody has ever counted this item (qtyOwned = 0). */
  counted: boolean
  /** Quantity on firm OTHER orders overlapping the window. */
  committed: number
  /** Quantity on OTHER orders still out as quotes. Never subtracted. */
  quoted: number
  /** onHand - committed. Can go negative when we are already oversold. */
  available: number
}

/**
 * The verdict the UI renders: how many are free for this line, and
 * whether the line has passed it. Lives here rather than in the chip so
 * the number, the color and anything that later wants to react to a
 * shortfall cannot disagree about what "enough" means.
 *
 * `otherOnThisOrder` is the same item on OTHER lines of the order being
 * edited: `getItemStock` leaves that order out of `committed` (a line
 * must not count against itself), so its siblings are netted by the
 * caller, which is also what makes the number move as someone types.
 *
 * `show: false` is the silence described at the top of this file — a
 * unit-tracked row, or an item nobody has counted.
 */
export function stockVerdict(
  stock: ItemStock | null | undefined,
  requested: number,
  otherOnThisOrder = 0,
): { show: false } | { show: true; available: number; over: boolean; short: number } {
  if (!stock || stock.mode !== 'QUANTITY' || !stock.counted) return { show: false }
  const available = stock.available - Math.max(0, otherOnThisOrder)
  const over = requested > available
  return { show: true, available, over, short: over ? requested - available : 0 }
}

export interface StockWindow {
  start: Date
  end: Date
}

/** One line of demand, as the pure summariser needs it. */
export interface DemandLine {
  inventoryItemId: string | null
  quantity: number
  /** Order-level window. The per-line override below wins when set. */
  pickupDate: Date
  returnDate: Date
  startDate: Date | null
  endDate: Date | null
  orderStatus: OrderStatus
  /** Quantities covered by live sub-rentals on this line. */
  subRentalQuantities: number[]
}

/**
 * The arithmetic, with no I/O: given candidate lines, how much of each
 * item is firmly committed over the window and how much is only quoted.
 *
 * Split out from the query because this is the part that, wrong, tells
 * an agent there is gear on the shelf that isn't there — boundary tests
 * in `tests/inventory/stock.test.ts`.
 */
export function summariseDemand(
  lines: DemandLine[],
  window: StockWindow,
): { committed: Map<string, number>; quoted: Map<string, number> } {
  const committed = new Map<string, number>()
  const quoted = new Map<string, number>()

  for (const line of lines) {
    const itemId = line.inventoryItemId
    if (!itemId) continue
    // Per-line dates override the order's — that is how the rest of the
    // app reads a line (`startDate ?? pickupDate`), and a line moved off
    // the order's window must be measured where it actually sits.
    const start = line.startDate ?? line.pickupDate
    const end = line.endDate ?? line.returnDate
    // Both endpoints inclusive: a line returning the day this window
    // opens still has the gear out that morning.
    if (!(start <= window.end && end >= window.start)) continue

    const subRented = line.subRentalQuantities.reduce((sum, q) => sum + q, 0)
    const fromOurShelf = Math.max(0, line.quantity - subRented)
    if (fromOurShelf === 0) continue

    const bucket = STOCK_COMMITTED_STATUSES.includes(line.orderStatus) ? committed : quoted
    bucket.set(itemId, (bucket.get(itemId) ?? 0) + fromOurShelf)
  }

  return { committed, quoted }
}

/**
 * Stock for a set of catalog rows over one window.
 *
 * `excludeOrderId` leaves the order being edited out of `committed` so
 * a line never counts against itself; the caller nets its own sibling
 * lines client-side, which is what makes the number move as an agent
 * types.
 */
export async function getItemStock(
  inventoryItemIds: string[],
  window: StockWindow,
  opts: { excludeOrderId?: string | null } = {},
): Promise<Map<string, ItemStock>> {
  const out = new Map<string, ItemStock>()
  const ids = [...new Set(inventoryItemIds.filter(Boolean))]
  if (ids.length === 0) return out

  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, qtyOwned: true, trackingMode: true },
  })

  const quantityIds = items.filter((i) => i.trackingMode === 'QUANTITY').map((i) => i.id)

  // Candidate demand. The effective window is `startDate ?? pickupDate`
  // and Prisma cannot COALESCE inside a where, so the query pulls a
  // SUPERSET — either date pair overlapping — and the exact overlap is
  // settled in JS below. (A null startDate makes the second branch
  // unsatisfiable, so the first branch is what catches those rows.)
  const lines = quantityIds.length
    ? await prisma.orderLineItem.findMany({
        where: {
          inventoryItemId: { in: quantityIds },
          order: {
            status: { in: [...STOCK_COMMITTED_STATUSES, ...STOCK_QUOTED_STATUSES] },
            ...(opts.excludeOrderId ? { id: { not: opts.excludeOrderId } } : {}),
          },
          OR: [
            { pickupDate: { lte: window.end }, returnDate: { gte: window.start } },
            { startDate: { lte: window.end }, endDate: { gte: window.start } },
          ],
        },
        select: {
          inventoryItemId: true,
          quantity: true,
          pickupDate: true,
          returnDate: true,
          startDate: true,
          endDate: true,
          order: { select: { status: true } },
          subRentals: {
            where: { status: { in: COVERING_SUB_RENTAL_STATUSES } },
            select: { quantity: true },
          },
        },
      })
    : []

  const { committed, quoted } = summariseDemand(
    lines.map((line) => ({
      inventoryItemId: line.inventoryItemId,
      quantity: line.quantity,
      pickupDate: line.pickupDate,
      returnDate: line.returnDate,
      startDate: line.startDate,
      endDate: line.endDate,
      orderStatus: line.order.status,
      subRentalQuantities: line.subRentals.map((s) => s.quantity),
    })),
    window,
  )

  for (const item of items) {
    if (item.trackingMode !== 'QUANTITY') {
      out.set(item.id, {
        inventoryItemId: item.id,
        mode: 'UNIT_TRACKED',
        onHand: 0,
        counted: false,
        committed: 0,
        quoted: 0,
        available: 0,
      })
      continue
    }
    const onHand = item.qtyOwned
    const c = committed.get(item.id) ?? 0
    out.set(item.id, {
      inventoryItemId: item.id,
      mode: 'QUANTITY',
      onHand,
      counted: onHand > 0,
      committed: c,
      quoted: quoted.get(item.id) ?? 0,
      available: onHand - c,
    })
  }

  return out
}
