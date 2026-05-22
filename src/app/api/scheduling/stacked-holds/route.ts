/**
 * GET /api/scheduling/stacked-holds?categoryId&start&end
 *
 * Returns the live hold-stack for a category window — every
 * BookingItem (rank 1, 2, 3, …) whose parent Booking overlaps the
 * window, ordered by holdRank then by Booking.createdAt (oldest
 * first within a rank). The shadow page renders this as
 * "held + N backups" with the queue order visible.
 *
 * Read-only.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function parseDate(s: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const categoryId = url.searchParams.get('categoryId')
  const start = parseDate(url.searchParams.get('start'))
  const end = parseDate(url.searchParams.get('end'))
  if (!categoryId) return NextResponse.json({ error: 'categoryId required' }, { status: 400 })
  if (!start || !end) return NextResponse.json({ error: 'start and end (YYYY-MM-DD) required' }, { status: 400 })

  const items = await prisma.bookingItem.findMany({
    where: {
      categoryId,
      status: { in: ['REQUESTED', 'ASSIGNED'] },
      booking: {
        archivedAt: null,
        startDate: { lte: end },
        endDate: { gte: start },
      },
    },
    select: {
      id: true,
      quantity: true,
      status: true,
      holdRank: true,
      booking: {
        select: {
          id: true,
          bookingNumber: true,
          jobName: true,
          startDate: true,
          endDate: true,
          createdAt: true,
          company: { select: { id: true, name: true } },
        },
      },
      _count: { select: { assignments: true } },
    },
    orderBy: [{ holdRank: 'asc' }, { booking: { createdAt: 'asc' } }],
  })

  const rows = items.map((i) => ({
    bookingItemId: i.id,
    bookingId: i.booking.id,
    bookingNumber: i.booking.bookingNumber,
    jobName: i.booking.jobName,
    company: i.booking.company,
    quantity: i.quantity,
    assignedCount: i._count.assignments,
    status: i.status,
    holdRank: i.holdRank,
    rentalStart: i.booking.startDate,
    rentalEnd: i.booking.endDate,
    createdAt: i.booking.createdAt,
  }))

  const counts = {
    primary: rows.filter((r) => r.holdRank === 1).length,
    backups: rows.filter((r) => r.holdRank >= 2).length,
  }

  return NextResponse.json({ ok: true, counts, rows })
}
