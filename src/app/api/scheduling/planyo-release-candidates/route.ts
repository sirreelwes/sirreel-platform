import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { normalizePlanyoUnitName } from '@/lib/scheduling/planyoNameNormalizer'

export const dynamic = 'force-dynamic'

/**
 * GET /api/scheduling/planyo-release-candidates
 *
 * Holds that Planyo says are CANCELLED but that are still consuming
 * capacity in HQ. The daily sync detects these and records them as
 * RELEASE_CANDIDATE events — deliberately without acting, because a
 * false positive frees a truck that is actually booked. This is the
 * human review queue that was missing: before it, the only signal was a
 * Slack alert, so a candidate nobody read stayed on the board forever.
 *
 * Candidates come from the most recent sync run that produced any, and
 * the run's timestamp is returned so staff can see how fresh the read is
 * rather than trusting a stale list.
 *
 * Each row resolves to a bookingItemId so the existing release endpoint
 * (booking-items/[id]/release) can do the actual work — one release
 * path, not a second implementation. Rows that can't be resolved are
 * returned with bookingItemId null and surfaced as needing manual
 * handling instead of being silently dropped.
 */
export async function GET() {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  // Most recent run that actually produced candidates.
  const run = await prisma.planyoSyncRun.findFirst({
    where: { events: { some: { op: 'RELEASE_CANDIDATE' } } },
    orderBy: { startedAt: 'desc' },
    select: { id: true, startedAt: true, finishedAt: true, dryRun: true, outcome: true },
  })
  if (!run) {
    return NextResponse.json({ ok: true, run: null, candidates: [] })
  }

  const events = await prisma.planyoSyncEvent.findMany({
    where: { runId: run.id, op: 'RELEASE_CANDIDATE' },
    select: { planyoReservationId: true, planyoCartId: true, detail: true },
  })
  const rids = events.map((e) => e.planyoReservationId).filter(Boolean) as string[]
  if (rids.length === 0) {
    return NextResponse.json({ ok: true, run, candidates: [] })
  }

  const reservations = await prisma.reservation.findMany({
    where: { planyoReservationId: { in: rids } },
    select: {
      id: true, planyoReservationId: true, unitName: true, category: true, startTime: true, endTime: true,
      planyoJobName: true, planyoCompany: true,
      booking: {
        select: {
          id: true, bookingNumber: true, status: true, jobName: true,
          company: { select: { name: true } },
          items: {
            select: {
              id: true, status: true,
              category: { select: { name: true } },
              assignments: {
                select: { id: true, status: true, asset: { select: { unitName: true } } },
              },
            },
          },
        },
      },
    },
  })
  const byRid = new Map(reservations.map((r) => [r.planyoReservationId!, r]))

  const candidates = events.map((ev) => {
    const r = ev.planyoReservationId ? byRid.get(ev.planyoReservationId) : undefined
    const booking = r?.booking ?? null

    // Resolve the item holding THIS unit. The journal has no
    // bookingItemId, and its unitName is the RAW Planyo string
    // ("8 (Mid Roof) A", "Super Cargo #43") which never equals an HQ
    // Asset.unitName — matching on it directly resolves 0 of 42. Run it
    // through the same normalizer the importer used to create the pair
    // and 39 of 42 land; single-item bookings cover the rest.
    let itemId: string | null = null
    let itemStatus: string | null = null
    let matchedBy: 'unit' | 'single-item' | null = null
    if (booking && r) {
      const match = booking.items.find((it) => {
        const cat = it.category?.name ?? r.category ?? ''
        const normalized = normalizePlanyoUnitName(r.unitName, cat).normalized
        return it.assignments.some(
          (a) => a.asset?.unitName === normalized || a.asset?.unitName === r.unitName,
        )
      })
      // Unambiguous even when the unit never resolved to an asset
      // (a category hold that was never assigned).
      const fallback = booking.items.length === 1 ? booking.items[0] : undefined
      const chosen = match ?? fallback
      if (chosen) matchedBy = match ? 'unit' : 'single-item'
      itemId = chosen?.id ?? null
      itemStatus = chosen?.status ?? null
    }

    return {
      planyoReservationId: ev.planyoReservationId,
      planyoCartId: ev.planyoCartId,
      unitName: r?.unitName ?? null,
      startTime: r?.startTime ?? null,
      endTime: r?.endTime ?? null,
      companyName: booking?.company?.name ?? r?.planyoCompany ?? null,
      jobName: booking?.jobName ?? r?.planyoJobName ?? null,
      bookingNumber: booking?.bookingNumber ?? null,
      bookingStatus: booking?.status ?? null,
      bookingItemId: itemId,
      matchedBy,
      // UNFULFILLED means someone already released it — kept visible so
      // the list reconciles with what you see on the board.
      alreadyReleased: itemStatus === 'UNFULFILLED',
      itemStatus,
      detail: ev.detail,
    }
  })

  // Live capacity first: what's still holding a truck matters most.
  candidates.sort((a, b) => {
    if (a.alreadyReleased !== b.alreadyReleased) return a.alreadyReleased ? 1 : -1
    return (a.startTime?.getTime() ?? 0) - (b.startTime?.getTime() ?? 0)
  })

  return NextResponse.json({ ok: true, run, candidates })
}
