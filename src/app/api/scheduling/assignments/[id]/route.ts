/**
 * GET /api/scheduling/assignments/[id] — one reserved unit, as the
 * order builder needs to see it.
 *
 * Wes 2026-09-10: "when we open a reservation we should be able to add
 * a warehouse order there, which will open the order fill-out and
 * assign it to be loaded on that vehicle." The reservation pop-up and
 * the job page link to /orders/new?loadOnAssignmentId=…; the builder
 * reads this to say WHICH truck the order is being written against
 * (unit, class, booking, dates, job) before anything is typed, and to
 * refuse a unit that already carries a different order.
 *
 * Read-only. The write is PATCH ./order, made after the order exists.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireReadSession } from '@/lib/scheduling/requireReadSession'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireReadSession()
  if (denied) return denied

  const { id } = await params
  const a = await prisma.bookingAssignment.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      asset: { select: { id: true, unitName: true } },
      order: { select: { id: true, orderNumber: true, status: true } },
      bookingItem: {
        select: {
          id: true,
          category: { select: { id: true, name: true } },
          booking: {
            select: {
              id: true,
              bookingNumber: true,
              jobId: true,
              job: { select: { id: true, jobCode: true, name: true, company: { select: { id: true, name: true } } } },
            },
          },
        },
      },
    },
  })
  if (!a) return NextResponse.json({ error: 'assignment not found' }, { status: 404 })

  const ymd = (d: Date) => d.toISOString().slice(0, 10)
  return NextResponse.json({
    ok: true,
    assignment: {
      id: a.id,
      status: a.status,
      startDate: ymd(a.startDate),
      endDate: ymd(a.endDate),
      unit: a.asset,
      category: a.bookingItem.category,
      booking: { id: a.bookingItem.booking.id, bookingNumber: a.bookingItem.booking.bookingNumber },
      job: a.bookingItem.booking.job,
      order: a.order,
    },
  })
}
