import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/timeline
 *
 * Reads the native `reservations` table — no live Planyo call. The
 * every-15-min Planyo→Reservation cron (Chunk 2) keeps the table
 * in lockstep with Planyo's own scheduling state.
 *
 * Response shape matches the previous live-Planyo implementation
 * so the existing gantt page doesn't need rework. New fields are
 * additive (bookingId, bookingNumber, portalLink, contactEmail,
 * contactPhone, isOrphan) — the gantt UI can opt into them
 * without breaking on the old payload.
 *
 * Grouping:
 *   - By Asset (`units` array) — every row grouped by `unitName`
 *   - By Job (`jobs` array)    — grouped by `bookingId` when linked,
 *                                else by `planyoCartId` (so multi-
 *                                unit orphan jobs cluster correctly
 *                                until they're linked by Dispatch)
 *
 * CANCELLED reservations are filtered from the response — they
 * stay in the DB for audit, but don't clutter the live timeline.
 */

// Same color palette as the prior implementation so the gantt
// legend continues to work without changes.
const CAT_COLORS: Record<string, string> = {
  cube:     '#3b82f6',
  cargo:    '#8b5cf6',
  pass:     '#06b6d4',
  pop:      '#f59e0b',
  cam:      '#ec4899',
  dlux:     '#10b981',
  scout:    '#f97316',
  studio:   '#6366f1',
  stakebed: '#78716c',
  general:  '#9ca3af',
}

function mapResourceToCat(resourceName: string | null | undefined): string {
  const n = (resourceName || '').toLowerCase()
  if (n.includes('cube') || n.includes('5 ton')) return 'cube'
  if (n.includes('cargo') || n.includes('super cargo')) return 'cargo'
  if (n.includes('passenger') || n.includes('pass van')) return 'pass'
  if (n.includes('popvan') || n.includes('pop van')) return 'pop'
  if (n.includes('camera') || n.includes('cam')) return 'cam'
  if (n.includes('dlux') || n.includes('de luxe')) return 'dlux'
  if (n.includes('scout') || n.includes('vtr')) return 'scout'
  if (n.includes('studio')) return 'studio'
  if (n.includes('stakebed') || n.includes('stake')) return 'stakebed'
  return 'general'
}

// Reservation.status enum → legacy gantt status string. The gantt's
// STATUS_COLORS keys on these legacy strings, so we keep them.
function mapReservationStatus(status: string): string {
  if (status === 'CONFIRMED') return 'booked'
  return 'hold' // HOLD
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function GET() {
  try {
    // Live window: today − 14d through today + 45d — matches the
    // prior live-Planyo window so reporting / muscle memory is
    // unchanged. (The sync cron's window is wider — last 7 / next 90
    // — so the table has rows on either side of this view.)
    const today = new Date()
    const from = new Date(today); from.setDate(from.getDate() - 14)
    const to = new Date(today); to.setDate(to.getDate() + 45)

    // Overlap query: any reservation whose [startTime, endTime]
    // intersects the [from, to] window. Two-sided range filter is
    // the standard equivalent of !(endTime<from || startTime>to).
    const rows = await prisma.reservation.findMany({
      where: {
        status: { not: 'CANCELLED' },
        startTime: { lte: to },
        endTime: { gte: from },
      },
      include: {
        booking: {
          select: {
            id: true,
            bookingNumber: true,
            jobName: true,
            productionName: true,
            status: true,
            company: { select: { name: true } },
            person: { select: { firstName: true, lastName: true, email: true, phone: true } },
            agent: { select: { name: true } },
            // Most recent paperwork-portal token for the portal link
            // payload. Picking the freshest row keeps stale tokens
            // out when a booking was re-sent.
            paperworkRequests: {
              orderBy: { sentAt: 'desc' },
              take: 1,
              select: { token: true },
            },
          },
        },
      },
      orderBy: { startTime: 'asc' },
    })

    // ── Common per-row payload ────────────────────────────────────
    interface BarPayload {
      reservationId: string
      planyoReservationId: string | null
      planyoCartId: string | null
      unit: string
      resourceName: string
      cat: string
      qty: number
      start: string
      end: string
      status: string
      adminNotes: string | null

      // Linkage / portal payload — null when the reservation is an
      // orphan (no Booking linked). gantt detail modal falls back
      // to Planyo-derived fields below.
      isOrphan: boolean
      bookingId: string | null
      bookingNumber: string | null
      company: string | null
      jobName: string | null
      productionName: string | null
      agent: string | null
      contactName: string | null
      contactEmail: string | null
      contactPhone: string | null
      portalLink: string | null
    }

    const bars: BarPayload[] = rows.map((r) => {
      const cat = mapResourceToCat(r.category || r.unitName)
      const b = r.booking
      const isOrphan = !b
      const contact = b?.person
      const contactName = contact ? `${contact.firstName} ${contact.lastName}`.trim() : null
      const portalToken = b?.paperworkRequests?.[0]?.token || null

      return {
        reservationId: r.id,
        planyoReservationId: r.planyoReservationId,
        planyoCartId: r.planyoCartId,
        unit: r.unitName,
        resourceName: r.category || r.unitName,
        cat,
        qty: 1, // Planyo `quantity` not preserved at sync; default 1
        start: iso(r.startTime),
        end: iso(r.endTime),
        status: mapReservationStatus(r.status),
        adminNotes: r.notes,

        isOrphan,
        bookingId: b?.id ?? null,
        bookingNumber: b?.bookingNumber ?? null,
        company: b?.company?.name ?? null,
        jobName: b?.jobName ?? null,
        productionName: b?.productionName ?? null,
        agent: b?.agent?.name ?? null,
        contactName,
        contactEmail: contact?.email ?? null,
        contactPhone: contact?.phone ?? null,
        portalLink: portalToken ? `/portal/${portalToken}` : null,
      }
    })

    // ── By-Asset view: group by unitName ──────────────────────────
    const unitMap = new Map<string, BarPayload[]>()
    for (const bar of bars) {
      const arr = unitMap.get(bar.unit) || []
      arr.push(bar)
      unitMap.set(bar.unit, arr)
    }
    const units = [...unitMap.entries()]
      .map(([unitName, list]) => ({
        unitName,
        cat: list[0]?.cat || 'general',
        resourceName: list[0]?.resourceName || '',
        bookings: list
          .slice()
          .sort((a, b) => a.start.localeCompare(b.start))
          // Field shape matches the prior /api/timeline asset payload
          // so the gantt page reads it without changes. New fields
          // (bookingId, bookingNumber, portalLink, etc.) are additive.
          .map((bar) => ({
            reservationId: bar.reservationId,
            cartId: bar.planyoCartId,
            clientName: bar.company || bar.unit,
            jobName: bar.jobName || '',
            productionName: bar.productionName,
            agent: bar.agent || '',
            rwOrderNumber: null,
            resourceName: bar.resourceName,
            cat: bar.cat,
            status: bar.status,
            start: bar.start,
            end: bar.end,
            adminNotes: bar.adminNotes,
            qty: bar.qty,
            isOrphan: bar.isOrphan,
            bookingId: bar.bookingId,
            bookingNumber: bar.bookingNumber,
            company: bar.company,
            contactName: bar.contactName,
            contactEmail: bar.contactEmail,
            contactPhone: bar.contactPhone,
            portalLink: bar.portalLink,
          })),
      }))
      .sort((a, b) => {
        const catOrder = ['cube', 'cargo', 'pass', 'pop', 'cam', 'dlux', 'scout', 'studio', 'stakebed', 'general']
        const ca = catOrder.indexOf(a.cat)
        const cb = catOrder.indexOf(b.cat)
        if (ca !== cb) return ca - cb
        return a.unitName.localeCompare(b.unitName, undefined, { numeric: true })
      })

    // ── By-Job view: group by bookingId when set, else planyoCartId.
    // Orphan jobs (no booking) still cluster correctly because their
    // cart_id groups multi-unit orders the team booked together.
    const jobMap = new Map<string, BarPayload[]>()
    for (const bar of bars) {
      const key = bar.bookingId
        ? `b:${bar.bookingId}`
        : bar.planyoCartId
          ? `c:${bar.planyoCartId}`
          : `r:${bar.reservationId}` // singleton orphan with no cart
      const arr = jobMap.get(key) || []
      arr.push(bar)
      jobMap.set(key, arr)
    }
    const jobs = [...jobMap.entries()].map(([key, list]) => {
      const first = list[0]
      const startDate = list.reduce((min, x) => (x.start < min ? x.start : min), list[0].start)
      const endDate = list.reduce((max, x) => (x.end > max ? x.end : max), list[0].end)
      const cat = first.cat

      return {
        id: key,
        cartId: first.planyoCartId,
        bookingId: first.bookingId,
        bookingNumber: first.bookingNumber,
        company: first.company || first.unit,
        jobName: first.jobName || first.unit,
        productionName: first.productionName,
        // Display label for the bar — booking number when linked,
        // Planyo reservation id otherwise so orphans are visually
        // distinguishable.
        jobNum: first.bookingNumber || `R${first.planyoReservationId || first.reservationId.slice(0, 6)}`,
        rwOrderNumber: null,
        contact: first.contactName || first.company || '',
        contactEmail: first.contactEmail,
        contactPhone: first.contactPhone,
        portalLink: first.portalLink,
        agent: first.agent || '',
        status: first.status,
        stage: first.status,
        startDate,
        endDate,
        color: CAT_COLORS[cat] || '#9ca3af',
        isOrphan: !first.bookingId,
        items: list.map((bar) => ({
          cat: bar.cat,
          unit: bar.unit,
          resourceName: bar.resourceName,
          qty: bar.qty,
          start: bar.start,
          end: bar.end,
          reservationId: bar.reservationId,
          planyoReservationId: bar.planyoReservationId,
          adminNotes: bar.adminNotes,
        })),
      }
    })
    jobs.sort((a, b) => a.startDate.localeCompare(b.startDate))

    return NextResponse.json({
      ok: true,
      jobs,
      units,
      total: bars.length,
      source: 'neon-reservation', // diagnostic — confirms native read
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[timeline] error', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
