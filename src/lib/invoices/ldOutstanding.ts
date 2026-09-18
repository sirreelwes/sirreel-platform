/**
 * Which orders still have loss & damage nobody has billed?
 *
 * Ana, 2026-09-18 (relayed by Wes): *"Have to bill out some L&D but already
 * sent out the invoice from the 'To Bill' module on my dashboard, so now I
 * don't have a quick way to bill losses."*
 *
 * That is a discoverability bug with a precise cause. The L&D composer has
 * existed since 2026-09-14, but its ONLY door was the billing-queue row's
 * "N short on the sheet" chip — and `billingQueue()` drops an order the
 * moment its rental invoice is sent (`if (o.invoices.some((i) => i.sentAt))
 * continue`). So sending the rental invoice, which is the whole job of that
 * screen, deletes the only way to bill the losses on the same order. The
 * shortfall is still on the sheet; the button is gone.
 *
 * This module is the L&D half of that queue, derived on its own terms:
 * whether the RENTAL invoice went out is none of its business. An order
 * belongs here while the check-in sheet says gear did not come back, or a
 * damage finding is triaged SEND_TO_LD and unbilled, and no live L&D
 * invoice covers it yet.
 *
 * Scope: this is the BATCH question — which orders, across the desk. The
 * per-order question already has an answer in `ldCandidates.ts`, served by
 * GET /api/orders/[id]/ld-invoices, and the order screen uses that rather
 * than a second derivation that could disagree with it. Both read the
 * shortfall through `missingOnCheckIn`, which is the one rule for what the
 * inbound sheet says did not come back.
 *
 * Nothing here bills anything. Same doctrine as the composer: a short count
 * is evidence, not a verdict — missing gear turns up on the truck the next
 * morning often enough that an invoice raising itself overnight would bill
 * a client for kit sitting in the yard.
 */

import { prisma } from '@/lib/prisma'
import { missingOnCheckIn } from '@/lib/invoices/ldMissingGear'

/** Match the billing queue's own window — an order that came back four
 *  months ago is an aging-review question, not today's work. */
export const LD_LOOKBACK_DAYS = 120

export interface LdOutstandingRow {
  orderId: string
  orderNumber: string
  jobId: string | null
  jobName: string | null
  companyName: string | null
  /** Lines the inbound sheet counted short (or recorded nothing back for). */
  shortLines: number
  /** Pieces missing across those lines — what the invoice would bill. */
  missingPieces: number
  /** Vehicle damage triaged SEND_TO_LD and not yet on any invoice. */
  damageFindings: number
  /** When the inbound sheet was filed, ISO. Null when the only finding is
   *  vehicle damage. Orders the lane, oldest first. */
  checkedInAt: string | null
  /** True once the rental invoice has gone to the client. Rendered as a
   *  chip, because it is exactly the case Ana lost: the rental is settled
   *  and the losses are still outstanding. */
  rentalInvoiceSent: boolean
}

/**
 * Unbilled SEND_TO_LD damage, counted per ORDER.
 *
 * The chain from a damage finding back to an order runs through the
 * booking (inspection → assignment → item → booking → order.bookingId), so
 * this walks it once for the whole set rather than per row. Orders with no
 * booking simply have no vehicle damage — their L&D is all gear.
 */
async function damageCountsByOrder(bookingIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (bookingIds.length === 0) return counts

  const damages = await prisma.damageItem.findMany({
    where: {
      disposition: 'SEND_TO_LD',
      invoiceId: null,
      inspection: {
        bookingAssignment: { bookingItem: { bookingId: { in: bookingIds } } },
      },
    },
    select: {
      id: true,
      inspection: {
        select: { bookingAssignment: { select: { bookingItem: { select: { bookingId: true } } } } },
      },
    },
  })

  for (const d of damages) {
    const bookingId = d.inspection.bookingAssignment?.bookingItem?.bookingId
    if (!bookingId) continue
    counts.set(bookingId, (counts.get(bookingId) ?? 0) + 1)
  }
  return counts
}

/**
 * Every order with L&D still to bill, newest shortfall last.
 *
 * Deliberately NOT filtered on `Order.status`. The paperwork on the truck
 * is routinely still a quote here (see REPORTABLE_ORDER_STATUSES), so a
 * check-in sheet can be filed against an order that never reached RETURNED
 * — and gear that did not come back is a loss whatever the order says. The
 * one status that is excluded is CANCELLED: nothing went out.
 */
export async function ldOutstanding(): Promise<LdOutstandingRow[]> {
  const cutoff = new Date(Date.now() - LD_LOOKBACK_DAYS * 86_400_000)

  const orders = await prisma.order.findMany({
    where: {
      status: { not: 'CANCELLED' },
      // No live L&D invoice — one per order, so an order that has one is
      // already handled and the composer would refuse anyway.
      invoices: { none: { type: 'LD', NOT: { status: 'VOID' } } },
      OR: [
        { checkReports: { some: { edge: 'IN', submittedAt: { gte: cutoff } } } },
        { bookingId: { not: null }, updatedAt: { gte: cutoff } },
      ],
    },
    select: {
      id: true,
      orderNumber: true,
      bookingId: true,
      job: { select: { id: true, name: true, company: { select: { name: true } } } },
      invoices: {
        where: { type: 'RENTAL', NOT: { status: 'VOID' } },
        select: { sentAt: true },
      },
      checkReports: {
        where: { edge: 'IN' },
        select: {
          submittedAt: true,
          lines: {
            select: {
              orderLineItemId: true,
              description: true,
              expectedQty: true,
              actualQty: true,
              change: true,
              onSheet: true,
              note: true,
            },
          },
        },
      },
    },
  })

  const damageCounts = await damageCountsByOrder(
    orders.map((o) => o.bookingId).filter((b): b is string => !!b),
  )

  const rows: LdOutstandingRow[] = []
  for (const o of orders) {
    const report = o.checkReports[0] ?? null
    const missing = report ? missingOnCheckIn(report.lines) : []
    const damageFindings = o.bookingId ? damageCounts.get(o.bookingId) ?? 0 : 0
    if (missing.length === 0 && damageFindings === 0) continue

    rows.push({
      orderId: o.id,
      orderNumber: o.orderNumber,
      jobId: o.job?.id ?? null,
      jobName: o.job?.name ?? null,
      companyName: o.job?.company?.name ?? null,
      shortLines: missing.length,
      missingPieces: missing.reduce((s, m) => s + m.missing, 0),
      damageFindings,
      checkedInAt: report?.submittedAt.toISOString() ?? null,
      rentalInvoiceSent: o.invoices.some((i) => i.sentAt),
    })
  }

  // Oldest shortfall first — the point of a queue is that nothing sits.
  // Rows with no sheet (vehicle damage only) sort last but keep a stable
  // order, so the lane does not reshuffle between refreshes.
  rows.sort(
    (a, b) =>
      (a.checkedInAt ?? '9999').localeCompare(b.checkedInAt ?? '9999') ||
      a.orderNumber.localeCompare(b.orderNumber),
  )
  return rows
}
