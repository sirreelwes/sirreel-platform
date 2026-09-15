import { prisma } from '@/lib/prisma'

/**
 * A unit does not go out on a cancelled order.
 *
 * `BookingAssignment.orderId` is the ONE precise link an order has to the
 * trucks reserved for it — stamped at assign time by `assignUnit`, which
 * deliberately excludes cancelled orders from its candidates. Nothing ever
 * unstamped it, so cancelling an order left every unit it named pointing at
 * a dead row, and every surface that reads "which order does this unit go
 * out on" kept answering with it: the gantt tooltip, the job page's Reserved
 * assets chip, the yard's Order-attached link.
 *
 * Wrong Number (SR-JOB-0273, 2026-09-15) is the case that surfaced it. The
 * rep rebuilt the order — S260915-004 cancelled, S260915-005 booked, same
 * three vans, same Sep 16 — and all three vans stayed stamped to -004. The
 * live order showed no units at all, and the client's portal (also still
 * pointed at -004) read a cancelled $660 order back to them.
 *
 * Where to put the units instead: the same rule `assignUnit` already uses
 * when nobody names an order — with exactly ONE live order left on the job
 * it is unambiguous, so stamp it; otherwise clear the stamp and let the tile
 * say "No order on this unit", which is at least true. Never guess between
 * two live orders.
 *
 * Deliberately does NOT touch the BookingItem hold quantity. A BookingItem
 * has no link back to the OrderLineItem that asked for it and the booking is
 * shared across the job's orders, so any sweep there releases holds belonging
 * to the orders still standing — the same reason the order DELETE path has no
 * auto-release. Freeing a cancelled order's share of a hold stays a per-hold
 * human action on the job page.
 *
 * NON-FATAL: an order must still cancel if this fails.
 */
export async function rehomeUnitsFromDeadOrder(
  orderId: string,
  userId: string | null = null,
): Promise<{
  moved: number
  released: number
  toOrderId: string | null
  toOrderNumber: string | null
  error: string | null
}> {
  const out = {
    moved: 0,
    released: 0,
    toOrderId: null as string | null,
    toOrderNumber: null as string | null,
    error: null as string | null,
  }
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, jobId: true },
    })
    if (!order) return { ...out, error: 'order not found' }

    // The rows this order actually owns — matched on the stamp itself, not
    // on the job or the booking, so an order's cancellation can never move a
    // unit that was never its.
    const stamped = await prisma.bookingAssignment.findMany({
      where: { orderId },
      select: { id: true, asset: { select: { unitName: true } } },
    })
    if (stamped.length === 0) return out

    const successors = order.jobId
      ? await prisma.order.findMany({
          where: {
            jobId: order.jobId,
            id: { not: orderId },
            // CANCELLED is the ONLY dead value on OrderStatus. LOST lives
            // on OrderQuoteStatus and VOID on invoices — naming either here
            // is a build error, and naming CLOSED would be wrong: a closed
            // order really did take those units out.
            status: { not: 'CANCELLED' },
            archivedAt: null,
          },
          select: { id: true, orderNumber: true },
        })
      : []
    const heir = successors.length === 1 ? successors[0] : null

    const ids = stamped.map((a) => a.id)
    const res = await prisma.bookingAssignment.updateMany({
      where: { id: { in: ids } },
      data: { orderId: heir?.id ?? null },
    })
    if (heir) {
      out.moved = res.count
      out.toOrderId = heir.id
      out.toOrderNumber = heir.orderNumber
    } else {
      out.released = res.count
    }

    await prisma.auditLog.create({
      data: {
        userId,
        action: heir ? 'assignment.order_rehomed' : 'assignment.order_released',
        entityType: 'Order',
        entityId: orderId,
        oldValues: { orderId, orderNumber: order.orderNumber },
        newValues: {
          toOrderId: heir?.id ?? null,
          toOrderNumber: heir?.orderNumber ?? null,
          assignmentIds: ids,
          units: stamped.map((a) => a.asset.unitName),
          // Why it landed where it did, so a later reader can tell a
          // deliberate release from an ambiguous one.
          reason:
            successors.length === 1
              ? 'one live order left on the job'
              : successors.length === 0
                ? 'no live order left on the job'
                : `${successors.length} live orders on the job — ambiguous, stamp cleared`,
        },
      },
    })
  } catch (err) {
    out.error = err instanceof Error ? err.message : 'unknown error'
  }
  return out
}
