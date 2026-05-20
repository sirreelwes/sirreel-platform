import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { autoMatch, type BookingCandidate, type OrphanInput } from '@/lib/planyo/autoMatch'

export const dynamic = 'force-dynamic'

/**
 * GET /api/dispatch/orphans
 *
 * Returns orphan Reservation rows (bookingId null) grouped by
 * planyoCartId — so multi-unit jobs cluster into a single linker
 * card rather than spamming 3 rows per job. Each group carries an
 * auto-match suggestion + confidence so the rep can bulk-confirm
 * the HIGH-confidence ones with one click.
 *
 * Auth: NextAuth session. Booking candidates are intentionally
 * scoped wide — active + recent bookings (any non-archived row
 * with end_date within ~120 days of today) — so a Booking that
 * was created 30 days ago for a shoot next week is in the
 * candidate set.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  // Orphan reservations — exclude cancelled so the queue mirrors
  // the timeline view; cancelled rows in the DB are audit-only.
  const orphans = await prisma.reservation.findMany({
    where: { bookingId: null, status: { not: 'CANCELLED' } },
    orderBy: { startTime: 'asc' },
  })

  // Booking candidates — broad recency window so we catch
  // bookings created weeks ahead of their shoot date.
  const candidateWindowDays = 120
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - candidateWindowDays)
  const upper = new Date()
  upper.setDate(upper.getDate() + candidateWindowDays)

  const candidates = await prisma.booking.findMany({
    where: {
      archivedAt: null,
      status: { notIn: ['CANCELLED', 'ARCHIVED'] },
      OR: [
        { endDate: { gte: cutoff } },
        { startDate: { lte: upper } },
      ],
    },
    select: {
      id: true,
      bookingNumber: true,
      jobName: true,
      productionName: true,
      startDate: true,
      endDate: true,
      company: { select: { name: true } },
    },
  })

  const bookingCandidates: BookingCandidate[] = candidates.map((b) => ({
    id: b.id,
    bookingNumber: b.bookingNumber,
    companyName: b.company?.name ?? null,
    jobName: b.jobName,
    productionName: b.productionName,
    startDate: b.startDate,
    endDate: b.endDate,
  }))

  // Group orphans by planyoCartId (singleton orphans without a
  // cart land in their own group keyed by reservation id).
  const groupMap = new Map<string, typeof orphans>()
  for (const r of orphans) {
    const key = r.planyoCartId ? `c:${r.planyoCartId}` : `r:${r.id}`
    const arr = groupMap.get(key) || []
    arr.push(r)
    groupMap.set(key, arr)
  }

  // For each group, pick a representative reservation (earliest
  // start) and run the auto-matcher against the Booking catalogue.
  const groups = [...groupMap.entries()].map(([key, list]) => {
    list.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    const rep = list[0]
    const orphanInput: OrphanInput = {
      planyoCompany: rep.planyoCompany,
      planyoJobName: rep.planyoJobName,
      startTime: rep.startTime,
      endTime: list.reduce((max, x) => (x.endTime > max ? x.endTime : max), list[0].endTime),
    }
    const match = autoMatch(orphanInput, bookingCandidates)

    return {
      key,
      planyoCartId: rep.planyoCartId,
      planyoCompany: rep.planyoCompany,
      planyoJobName: rep.planyoJobName,
      planyoAgent: rep.planyoAgent,
      unitCount: list.length,
      units: list.map((u) => ({
        reservationId: u.id,
        planyoReservationId: u.planyoReservationId,
        unitName: u.unitName,
        category: u.category,
        startTime: u.startTime,
        endTime: u.endTime,
        status: u.status,
        notes: u.notes,
      })),
      match,
    }
  })

  // Surface HIGH-confidence matches first so the rep can rip
  // through them, then MEDIUM, then everything else.
  const order: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3 }
  groups.sort((a, b) => {
    const ca = order[a.match.confidence]
    const cb = order[b.match.confidence]
    if (ca !== cb) return ca - cb
    return a.units[0].startTime.getTime() - b.units[0].startTime.getTime()
  })

  const counts = {
    total: groups.length,
    high: groups.filter((g) => g.match.confidence === 'HIGH').length,
    medium: groups.filter((g) => g.match.confidence === 'MEDIUM').length,
    low: groups.filter((g) => g.match.confidence === 'LOW').length,
    none: groups.filter((g) => g.match.confidence === 'NONE').length,
  }

  return NextResponse.json({ ok: true, counts, groups })
}
