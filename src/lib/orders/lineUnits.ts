/**
 * The through line from an ORDER LINE to the TRUCK reserved for it.
 *
 * Wes 2026-09-16: "We need a through line between assets reserved on our
 * reservations and the asset listed in the orders. If we change the type
 * of vehicle in an order from cargo van to cube truck, we need the system
 * to require us to switch the unit type in the reservations … If we
 * remove a cube truck from an order, it should be a specific cube truck
 * so that, in that order line, we can even see cube 34."
 *
 * A hold (BookingItem) is a CATEGORY line with a quantity, shared by every
 * order on the job, and the truck lives on a BookingAssignment under it.
 * Before 2026-09-16 an assignment knew its ORDER (orderId) but not which
 * LINE, so removing "1× Cube Truck" from an order decremented a quantity
 * and left every Cube where it was — or, at quantity zero, deleted the
 * whole item and every sibling order's trucks with it. Now a unit bound
 * for a line carries `BookingAssignment.orderLineItemId`, and these
 * helpers are the ONE place that reads it back:
 *
 *   · `holdCategoryIdForLine`  — the fleet class a line holds, whether the
 *                                line names an AssetCategory or a catalog row
 *   · `liveUnitsForLine`       — the trucks bound to THIS line (with the
 *                                legacy fallback for rows stamped before the
 *                                column existed)
 *   · `releaseLineUnits`       — take exactly those trucks off the
 *                                reservation, by asset, plus the line's
 *                                unassigned share of the hold
 *
 * Every write goes through `releaseBookingItem` so the audit row, the
 * quantity arithmetic and the status transitions are the same ones the
 * Gantt bar and the job page use.
 */
import { prisma } from '@/lib/prisma'
import { releaseBookingItem, type ReleaseActor } from '@/lib/scheduling/releaseBookingItem'
import { splitHoldUnits, LIVE_UNIT_STATUSES } from '@/lib/orders/lineUnitClaim'

/** Re-exported from the pure rule so there is one list, not two —
 *  lineUnitClaim.ts owns it and the order page reads it too. */
export const LIVE_ASSIGNMENT_STATUSES = LIVE_UNIT_STATUSES
const LIVE_ITEM_STATUSES = ['REQUESTED', 'ASSIGNED'] as const

const HOLD_DEPARTMENTS = new Set(['VEHICLES', 'STAGES'])

/**
 * The AssetCategory a line's hold is keyed on. A line added from the
 * order form's catalog box carries `inventoryItemId` and NO
 * `assetCategoryId`, so any path that keys on the category column alone
 * misses every ordinary vehicle line (holdOnQuoteSend resolves it the
 * same way: a unit-tracked catalog row → legacyAssetCategoryId).
 */
export async function holdCategoryIdForLine(line: {
  department: string
  assetCategoryId: string | null
  inventoryItemId: string | null
}): Promise<string | null> {
  if (!HOLD_DEPARTMENTS.has(line.department)) return null
  if (line.assetCategoryId) return line.assetCategoryId
  if (!line.inventoryItemId) return null
  const row = await prisma.inventoryItem.findUnique({
    where: { id: line.inventoryItemId },
    select: { trackingMode: true, legacyAssetCategoryId: true },
  })
  return row?.trackingMode === 'UNIT_TRACKED' && row.legacyAssetCategoryId ? row.legacyAssetCategoryId : null
}

export interface LineUnit {
  assignmentId: string
  assetId: string
  unitName: string
  status: string
  startDate: Date
  endDate: Date
  /** True when the row carries the line stamp; false for a legacy match. */
  stamped: boolean
}

/**
 * The hold a line raised — this order's booking, the line's class, live,
 * lowest rank first. Null when nothing is held (no booking yet, or the
 * class resolved to nothing).
 */
export async function holdItemForLine(args: {
  orderId: string
  categoryId: string
}): Promise<{ id: string; quantity: number; holdRank: number; status: string } | null> {
  const order = await prisma.order.findUnique({ where: { id: args.orderId }, select: { bookingId: true } })
  if (!order?.bookingId) return null
  return prisma.bookingItem.findFirst({
    where: { bookingId: order.bookingId, categoryId: args.categoryId, status: { in: [...LIVE_ITEM_STATUSES] } },
    orderBy: { holdRank: 'asc' },
    select: { id: true, quantity: true, holdRank: true, status: true },
  })
}

/**
 * The trucks bound to THIS line, live only.
 *
 * Stamped rows win outright. When the line has none — every assignment
 * bound before 2026-09-16, and a unit picked on the board with no line
 * in view — fall back to the order's own unstamped assignments on that
 * hold whose dates match the line's block exactly, capped at the line's
 * quantity. Exact match, never overlap: the 9/28→9/30 van overlaps the
 * 9/29→9/30 block and is not that block's truck (assignWindow.ts).
 */
export async function liveUnitsForLine(args: {
  orderId: string
  lineId: string
  categoryId: string
  quantity: number
  /** The line's block. The legacy fallback matches on it, so an omitted
   *  window finds no unstamped truck — every caller passes one. */
  window: { start: Date; end: Date } | null
}): Promise<{ item: { id: string; quantity: number; holdRank: number; status: string } | null; units: LineUnit[] }> {
  const item = await holdItemForLine({ orderId: args.orderId, categoryId: args.categoryId })
  if (!item) return { item: null, units: [] }
  const rows = await prisma.bookingAssignment.findMany({
    where: { bookingItemId: item.id, status: { in: [...LIVE_ASSIGNMENT_STATUSES] } },
    select: {
      id: true, assetId: true, status: true, startDate: true, endDate: true, orderId: true, orderLineItemId: true,
      asset: { select: { unitName: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  // ONE rule, shared with the order page's readout (lineUnitClaim.ts) —
  // what the row prints has to be what a delete or a trim gives back.
  const { mine, stamped } = splitHoldUnits({
    assignments: rows,
    orderId: args.orderId,
    line: {
      id: args.lineId,
      quantity: args.quantity,
      pickupDate: args.window?.start ?? null,
      returnDate: args.window?.end ?? null,
    },
  })
  return {
    item,
    units: mine.map((r) => ({
      assignmentId: r.id, assetId: r.assetId, unitName: r.asset.unitName, status: r.status,
      startDate: r.startDate, endDate: r.endDate, stamped,
    })),
  }
}

export interface LineReleaseOutcome {
  /** Nothing was held for the line, so nothing came down. */
  held: boolean
  bookingItemId: string | null
  /** The trucks that came off the reservation, by name. */
  units: string[]
  /** Unassigned slots of the hold given back alongside them. */
  pooledSlots: number
  /** What the hold reads after the release. */
  quantityAfter: number | null
  status: string | null
}

/**
 * Take a line's trucks off the reservation — by ASSET, never the whole
 * hold, because the hold is shared by every line of that class on the
 * job — and hand back the line's unassigned share of the quantity.
 *
 * `count` is how many of the line's slots are going: the whole line on
 * delete, the delta on a quantity edit. Stamped units go last-bound
 * first, so trimming 3 → 2 drops the truck most recently added.
 *
 * `keep` is how many trucks the line still wants afterwards (its new
 * quantity on a trim). Unbound slots go before a bound truck does: a line
 * of 18 with one van on it, trimmed to 1, gives back 17 EMPTY slots and
 * keeps its van. Without it the trim took every truck first (2026-09-17).
 *
 * Non-fatal by contract: the caller has already changed the line, and a
 * release that could not run is reported, not thrown.
 */
export async function releaseLineUnits(args: {
  orderId: string
  line: { id: string; quantity: number; pickupDate: Date; returnDate: Date }
  categoryId: string
  count?: number
  keep?: number
  actor: ReleaseActor
}): Promise<LineReleaseOutcome> {
  const none: LineReleaseOutcome = { held: false, bookingItemId: null, units: [], pooledSlots: 0, quantityAfter: null, status: null }
  try {
    const { item, units } = await liveUnitsForLine({
      orderId: args.orderId,
      lineId: args.line.id,
      categoryId: args.categoryId,
      quantity: args.line.quantity,
      window: { start: args.line.pickupDate, end: args.line.returnDate },
    })
    if (!item) return none
    const count = Math.max(0, Math.floor(args.count ?? args.line.quantity))
    if (count === 0) return { ...none, held: true, bookingItemId: item.id, quantityAfter: item.quantity, status: item.status }
    // Last-bound first: the most recently added truck is the one a
    // quantity trim takes back.
    const keep = Math.max(0, Math.floor(args.keep ?? 0))
    const going = [...units].reverse().slice(0, Math.min(count, Math.max(0, units.length - keep)))
    const pooledSlots = Math.max(0, count - going.length)
    const rel = await releaseBookingItem(item.id, {
      assetIds: going.map((u) => u.assetId),
      pooledSlots,
      actor: args.actor,
    })
    if (!rel.ok) {
      console.error('[releaseLineUnits] release refused:', rel.reason)
      return { ...none, held: true, bookingItemId: item.id, quantityAfter: item.quantity, status: item.status }
    }
    return {
      held: true,
      bookingItemId: item.id,
      units: going.map((u) => u.unitName),
      pooledSlots,
      quantityAfter: rel.quantity,
      status: rel.status,
    }
  } catch (err) {
    console.error('[releaseLineUnits] failed:', err instanceof Error ? err.message : err)
    return none
  }
}

/** Plain words for a toast or an audit note: "Cube 34 and Cube 12". */
export function namesInWords(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
