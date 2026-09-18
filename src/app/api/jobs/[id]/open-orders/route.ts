/**
 * GET /api/jobs/[id]/open-orders — the orders on a job that a new
 * reservation could join.
 *
 * Wes, 2026-09-18: "When you make a reservation and add it to a current
 * job, it needs to require the agent to add it to a specific open order or
 * start a new order in that job."
 *
 * Make Reservation used to mint a NEW order every time. On a job that
 * already had one that meant two orders for one rental — two quotes, two
 * agreements, two invoices — and the second reservation's vehicles sat on
 * an order nobody was looking at. This is the list the modal makes the
 * agent choose from.
 *
 * OPEN means the order can still take a vehicle: not returned, not
 * invoiced, not closed, not cancelled, not archived, not a lost or expired
 * quote. Newest first, with enough on each row (dates, what is on it, the
 * status) to pick the right one without opening it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireReadSession } from '@/lib/scheduling/requireReadSession'
import { toCalendarDateString } from '@/lib/dates/calendarDate'

export const dynamic = 'force-dynamic'

/** Statuses where the money has been said — a new vehicle belongs on a
 *  new order, not on one of these. */
const CLOSED_OUT = ['RETURNED', 'LD_CHECK', 'INVOICED', 'CLOSED', 'CANCELLED'] as const

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireReadSession()
  if (denied) return denied

  const { id } = await params
  const orders = await prisma.order.findMany({
    where: {
      jobId: id,
      archivedAt: null,
      status: { notIn: [...CLOSED_OUT] },
      quoteStatus: { notIn: ['LOST', 'EXPIRED'] },
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 25,
    select: {
      id: true, orderNumber: true, status: true, quoteStatus: true,
      startDate: true, endDate: true, total: true, createdAt: true,
      lineItems: { select: { id: true, description: true, quantity: true, department: true } },
    },
  })

  return NextResponse.json({
    ok: true,
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      quoteStatus: o.quoteStatus,
      startDate: o.startDate ? toCalendarDateString(o.startDate) : null,
      endDate: o.endDate ? toCalendarDateString(o.endDate) : null,
      total: Number(o.total ?? 0),
      lineCount: o.lineItems.length,
      // What is ON it, in the rep's words — enough to tell two orders on
      // one job apart at a glance.
      summary: o.lineItems
        .filter((li) => li.department === 'VEHICLES' || li.department === 'STAGES')
        .slice(0, 3)
        .map((li) => (li.quantity > 1 ? `${li.quantity}× ${li.description}` : li.description))
        .join(', '),
    })),
  })
}
