/**
 * GET /api/scheduling/stale-holds?days=N
 *
 * Chunk 6 of native-scheduling-v1-brief.md. Lists BookingItems with
 * status=REQUESTED whose parent Booking was created more than N days
 * ago (default 14). Powers the manual-sweep view — there is NO cron
 * or auto-expiry per the brief: holds persist until manually
 * released.
 *
 * Excludes archived Bookings. Includes partially-assigned items
 * (still REQUESTED if count < quantity) so reps see them surface in
 * the sweep too.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const DEFAULT_THRESHOLD_DAYS = 14
const MAX_THRESHOLD_DAYS = 365

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const requestedDays = parseInt(url.searchParams.get('days') ?? `${DEFAULT_THRESHOLD_DAYS}`, 10)
  const days = Math.min(MAX_THRESHOLD_DAYS, Math.max(0, Number.isFinite(requestedDays) ? requestedDays : DEFAULT_THRESHOLD_DAYS))
  const cutoff = new Date(Date.now() - days * 86_400_000)

  const items = await prisma.bookingItem.findMany({
    where: {
      status: 'REQUESTED',
      booking: {
        archivedAt: null,
        createdAt: { lt: cutoff },
      },
    },
    select: {
      id: true,
      quantity: true,
      dailyRate: true,
      status: true,
      notes: true,
      category: { select: { id: true, name: true, slug: true } },
      booking: {
        select: {
          id: true,
          bookingNumber: true,
          jobName: true,
          productionName: true,
          startDate: true,
          endDate: true,
          createdAt: true,
          status: true,
          company: { select: { id: true, name: true } },
          person: { select: { id: true, firstName: true, lastName: true, email: true } },
          agent: { select: { id: true, name: true, email: true } },
        },
      },
      _count: { select: { assignments: true } },
    },
    orderBy: { booking: { createdAt: 'asc' } }, // oldest first — those need the sweep most
  })

  const rows = items.map((it) => ({
    bookingItemId: it.id,
    bookingId: it.booking.id,
    bookingNumber: it.booking.bookingNumber,
    jobName: it.booking.jobName,
    productionName: it.booking.productionName,
    category: it.category,
    quantity: it.quantity,
    assignedCount: it._count.assignments,
    remaining: Math.max(0, it.quantity - it._count.assignments),
    rentalStart: it.booking.startDate,
    rentalEnd: it.booking.endDate,
    createdAt: it.booking.createdAt,
    ageDays: Math.floor((Date.now() - it.booking.createdAt.getTime()) / 86_400_000),
    company: it.booking.company,
    person: it.booking.person,
    agent: it.booking.agent,
    bookingStatus: it.booking.status,
    notes: it.notes,
  }))

  return NextResponse.json({ ok: true, days, cutoff, count: rows.length, rows })
}
