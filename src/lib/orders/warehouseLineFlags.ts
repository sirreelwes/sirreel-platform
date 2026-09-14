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
export type WarehouseFlagKind = 'SUBSTITUTE' | 'SHORT' | 'EXTRA' | 'REMOVED'

const FLAG_LABELS: Record<WarehouseFlagKind, string> = {
  SUBSTITUTE: 'Swapped at pickup',
  SHORT: 'Went out short',
  EXTRA: 'Extra went out',
  REMOVED: 'Did not go out',
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
  added: WarehouseAddedLine[]
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
  if (!report) return null

  const byLineId: Record<string, WarehouseLineFlag> = {}
  const added: WarehouseAddedLine[] = []

  for (const l of report.lines) {
    // A line left OFF a partial pull says nothing about itself — it was
    // not counted, not changed. Its `change` is already forced to NONE
    // on write, but read it defensively: a stale row from before
    // partial pulls existed must not print as a difference.
    if (!l.onSheet || l.change === 'NONE') continue

    if (l.change === 'ADDED' || !l.orderLineItemId) {
      added.push({
        description: l.description,
        quantity: l.actualQty,
        note: l.note,
      })
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

  return {
    filedAt: report.submittedAt.toISOString(),
    preppedBy: report.preppedBy,
    byLineId,
    added,
  }
}
