import { prisma } from '@/lib/prisma'
import { deriveOrderWindow } from '@/lib/jobs/dateRange'

/**
 * Rewrite an order's stored startDate / endDate from the thing that
 * actually carries dates: its line items, falling back to a live hold.
 *
 * Wes 2026-09-02: "let's just remove the header dates altogether." The
 * header is gone as a SOURCE — deriveOrderWindow no longer reads it — but
 * roughly forty surfaces still read `order.startDate` straight off the row,
 * including the signed rental agreement's "Rental period" (blank or wrong
 * on 30 of 35 agreements until it was fixed on 2026-08-31). Dropping the
 * column would reintroduce that, so it stays as a MIRROR: never typed by a
 * person, never authoritative, recomputed here whenever line dates move.
 *
 * Two rules that matter:
 *
 *  - Null is never written over a real value. An order whose lines carry no
 *    dates and has no live hold keeps whatever it had, so a fee-only order
 *    does not silently lose the period its contract prints.
 *  - No-ops don't write. The common case (nothing moved) touches nothing,
 *    so `updatedAt` stays honest and the /jobs "recently touched" sort is
 *    not churned by every unrelated line edit.
 */
export async function syncOrderWindow(
  orderId: string,
): Promise<{ changed: boolean; start: Date | null; end: Date | null }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      startDate: true,
      endDate: true,
      lineItems: { select: { pickupDate: true, returnDate: true } },
      booking: { select: { startDate: true, endDate: true, status: true } },
      job: { select: { bookings: { select: { startDate: true, endDate: true, status: true } } } },
    },
  })
  if (!order) return { changed: false, start: null, end: null }

  const derived = deriveOrderWindow(order)
  const same = (a: Date | null, b: Date | null) =>
    a === null && b === null ? true : !!a && !!b && a.getTime() === b.getTime()

  const nextStart = derived.start ?? order.startDate
  const nextEnd = derived.end ?? order.endDate
  if (same(nextStart, order.startDate) && same(nextEnd, order.endDate)) {
    return { changed: false, start: order.startDate, end: order.endDate }
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { startDate: nextStart, endDate: nextEnd },
  })
  return { changed: true, start: nextStart, end: nextEnd }
}

/** Fire-and-report variant for routes where a mirror refresh must never be
 *  the reason a line edit fails. */
export async function syncOrderWindowSafe(orderId: string): Promise<void> {
  try {
    await syncOrderWindow(orderId)
  } catch (err) {
    console.error('[syncOrderWindow] failed for', orderId, err)
  }
}
