/**
 * What the warehouse changed at pickup, per order line — the staff-only
 * flag on the order.
 *
 * Oliver, 2026-09-13: "on RW when they add or swap something, we can see
 * a little red flag by the item on the order to denote this item was
 * added or swapped by warehouse at the time of pickup. The client
 * doesn't see this red flag, nor should they."
 *
 * The facts already existed — a filed check-OUT report stores a
 * per-line `change` and, for a swap, the description of the item that
 * was replaced (see OrderCheckReportLine). Nothing read them back onto
 * the order: the only surfacing was the order-LEVEL `changedOrder` flag
 * that drives the agent's action item, which says an order was touched
 * without ever saying which line. So an agent looking at a rewritten
 * order saw the new numbers with no indication they were not the ones
 * the client approved.
 *
 * Read the OUT edge only. Check-IN is never applied to the order (gear
 * that did not come back is missing gear, not a smaller rental — see
 * lib/orders/checkReports.ts), so an IN difference is not a fact about
 * what the order says.
 *
 * CLIENT-FACING SURFACES MUST NOT CALL THIS. The quote PDF, the job
 * portal and the client emails build their lines from the order's own
 * rows; this module is the staff read, wired only into
 * GET /api/orders/[id], which the middleware gates to a staff session.
 */

import { prisma } from '@/lib/prisma'
import { describeCheckChange } from '@/lib/orders/checkLineChange'

/** The differences that are a fact about an ORDER LINE. NONE is not a
 *  flag, and ADDED has no line to hang on — it comes back separately. */
export type WarehouseFlagKind =
  | 'SUBSTITUTE' | 'SHORT' | 'EXTRA' | 'REMOVED'
  // As of 2026-09-14 a written-in row BECOMES an order line, so ADDED is
  // a per-line flag too — and UNPRICED is the one that matters, because
  // that line is holding the invoice.
  | 'ADDED' | 'UNPRICED'

const FLAG_LABELS: Record<WarehouseFlagKind, string> = {
  SUBSTITUTE: 'Swapped at pickup',
  SHORT: 'Went out short',
  EXTRA: 'Extra went out',
  REMOVED: 'Did not go out',
  ADDED: 'Added at pickup',
  UNPRICED: 'Added — needs a price',
}

export interface WarehouseLineFlag {
  kind: WarehouseFlagKind
  /** Two or three words for the chip. */
  label: string
  /** The same sentence the agent's flag, the audit row and the client's
   *  corrected quote were written from — one wording, one place. */
  detail: string
  /** What the floor wrote next to the line, if anything. */
  note: string | null
  /** Nobody has priced this line and it is blocking the invoice. */
  unpriced?: boolean
}

/** A row the warehouse wrote in that was never on the order. It is
 *  deliberately never written onto the order (the yard cannot see rates
 *  and a $0 line would under-bill the job), so the order can only ever
 *  show it alongside the lines, never as one. */
export interface WarehouseAddedLine {
  description: string
  quantity: number
  note: string | null
}

export interface OrderWarehouseFlags {
  /** When the sheet was filed. ISO — the client component formats it.
   *  Its presence is also what says a driver's receipt can be printed. */
  filedAt: string
  /** The associate named on the paper. */
  preppedBy: string | null
  /** Keyed by OrderLineItem id. */
  byLineId: Record<string, WarehouseLineFlag>
  /** Written-in rows that never became order lines. Only reports filed
   *  BEFORE 2026-09-14 have these — see the note in the loader. */
  added: WarehouseAddedLine[]
  /** Lines on this order with no price, which is what blocks the
   *  invoice and the client's corrected quote. */
  unpricedCount: number
}

/**
 * Null ONLY when no check-out sheet has been filed.
 *
 * A filed sheet that recorded no differences still comes back, with both
 * collections empty — that is the overwhelmingly common case and the
 * order correctly looks untouched, but it is also the difference between
 * "nothing happened" and "the gear went out exactly as ordered", and the
 * driver's receipt prints off the second one.
 */
export async function loadOrderWarehouseFlags(
  orderId: string,
): Promise<OrderWarehouseFlags | null> {
  const report = await prisma.orderCheckReport.findUnique({
    where: { orderId_edge: { orderId, edge: 'OUT' } },
    select: {
      submittedAt: true,
      preppedBy: true,
      lines: {
        select: {
          orderLineItemId: true,
          description: true,
          expectedQty: true,
          actualQty: true,
          change: true,
          onSheet: true,
          substituteFor: true,
          note: true,
        },
      },
    },
  })
  // Lines the warehouse PUT ON the order (2026-09-14). Read from the
  // LINE, not the report, because the report is not durable about this:
  // re-filing a corrected sheet sees an ordinary order line by then and
  // reclassifies the row to NONE, so the fact that the yard added it
  // would vanish on the second filing. `warehouseAddedAt` does not.
  //
  // Also read independently of the report existing at all — an unpriced
  // line has to stay visible even if someone later deletes the sheet.
  const warehouseLines = await prisma.orderLineItem.findMany({
    where: {
      orderId,
      OR: [{ warehouseAddedAt: { not: null } }, { pricingPendingAt: { not: null } }],
    },
    select: {
      id: true, description: true, quantity: true, notes: true,
      warehouseAddedAt: true, warehouseAddedBy: true, pricingPendingAt: true,
    },
  })

  if (!report && warehouseLines.length === 0) return null

  const byLineId: Record<string, WarehouseLineFlag> = {}
  const added: WarehouseAddedLine[] = []

  for (const l of report?.lines ?? []) {
    // A line left OFF a partial pull says nothing about itself — it was
    // not counted, not changed. Its `change` is already forced to NONE
    // on write, but read it defensively: a stale row from before
    // partial pulls existed must not print as a difference.
    if (!l.onSheet || l.change === 'NONE') continue

    // A written-in row with no order line behind it. Since 2026-09-14
    // every one of these becomes a line, so this is the LEGACY path: the
    // nine sheets filed before that date, which are deliberately left
    // alone rather than back-filled onto orders that may already be
    // invoiced. They still show on the order, just not as lines.
    if (l.change === 'ADDED' || !l.orderLineItemId) {
      if (!l.orderLineItemId) {
        added.push({ description: l.description, quantity: l.actualQty, note: l.note })
      }
      continue
    }

    byLineId[l.orderLineItemId] = {
      kind: l.change as WarehouseFlagKind,
      label: FLAG_LABELS[l.change as WarehouseFlagKind] ?? 'Changed at pickup',
      detail: describeCheckChange(
        {
          orderLineItemId: l.orderLineItemId,
          description: l.description,
          expectedQty: l.expectedQty,
          actualQty: l.actualQty,
          substituteFor: l.substituteFor,
        },
        l.change,
      ),
      note: l.note,
    }
  }

  // The line's own provenance WINS over the report row — it is the
  // durable fact, and on an unpriced line it is also the more urgent
  // one. Written after the report loop for exactly that reason.
  let unpricedCount = 0
  for (const l of warehouseLines) {
    const unpriced = l.pricingPendingAt != null
    if (unpriced) unpricedCount += 1
    const kind: WarehouseFlagKind = unpriced ? 'UNPRICED' : 'ADDED'
    byLineId[l.id] = {
      kind,
      label: FLAG_LABELS[kind],
      detail: unpriced
        ? `${l.quantity}× ${l.description} went out with no price — the warehouse added it at check-out and could not name it from the catalog. The order cannot be invoiced until it has a rate.`
        : `added ${l.description} ×${l.quantity} at check-out`,
      note: l.notes,
      unpriced,
    }
  }

  return {
    // A sheet may have been deleted out from under an unpriced line; the
    // line's own stamp is then the only date there is.
    filedAt: (
      report?.submittedAt ??
      warehouseLines[0]?.warehouseAddedAt ??
      warehouseLines[0]?.pricingPendingAt ??
      new Date()
    ).toISOString(),
    preppedBy: report?.preppedBy ?? warehouseLines[0]?.warehouseAddedBy ?? null,
    byLineId,
    added,
    unpricedCount,
  }
}
