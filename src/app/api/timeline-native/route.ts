/**
 * GET /api/timeline-native — native-sourced Timeline data.
 *
 * Drop-in shape replacement for /api/timeline (which reads Planyo).
 * Sources every field from BookingAssignment / BookingItem / Booking
 * / Asset, so the gantt / dashboard / calendar pages can swap to it
 * with no UI changes once the comparison page shows convergence.
 *
 * Response shape (matches /api/timeline):
 *   {
 *     ok: true,
 *     jobs:  [{ id, cartId, company, jobName, jobNum, ..., items: [...] }],
 *     units: [{ unitName, cat, resourceName, bookings: [...] }],
 *     total: number
 *   }
 *
 * Used by Chunk 7.5b parallel/flag work — runs alongside /api/timeline
 * during the convergence-verification window, retires it at Chunk 8.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// Same short-key mapping the existing /api/timeline uses, applied to
// AssetCategory.name instead of Planyo resource names. Keeps the
// gantt's color palette + sort order working unchanged.
function mapCategoryName(name: string | null | undefined): string {
  const n = (name ?? '').toLowerCase()
  if (n.includes('cube') || n.includes('5 ton')) return 'cube'
  if (n.includes('cargo') || n.includes('super cargo')) return 'cargo'
  if (n.includes('passenger') || n.includes('pass van')) return 'pass'
  if (n.includes('popvan') || n.includes('pop van')) return 'pop'
  if (n.includes('camera') || n.includes('cam')) return 'cam'
  if (n.includes('dlux') || n.includes('de luxe')) return 'dlux'
  if (n.includes('scout') || n.includes('vtr')) return 'scout'
  if (n.includes('lankershim') || n.includes('studio')) return 'studio'
  if (n.includes('stakebed') || n.includes('stake')) return 'stakebed'
  return 'general'
}

const CAT_COLORS: Record<string, string> = {
  cube: '#3b82f6',
  cargo: '#8b5cf6',
  pass: '#06b6d4',
  pop: '#f59e0b',
  cam: '#ec4899',
  dlux: '#10b981',
  scout: '#f97316',
  studio: '#6366f1',
  stakebed: '#78716c',
  general: '#9ca3af',
}

// Match the existing endpoint's lifecycle map: convert a SirReel
// BookingStatus into the timeline-display token the gantt cares
// about. Anything REQUEST → inquiry, HOLD-like → hold, everything
// else → booked.
function mapStatus(status: string): string {
  switch (status) {
    case 'REQUEST':
      return 'inquiry'
    case 'AI_REVIEW':
    case 'PENDING_APPROVAL':
      return 'hold'
    case 'CONFIRMED':
    case 'ACTIVE':
    case 'RETURNED':
    case 'ARCHIVED':
      return 'booked'
    case 'CANCELLED':
      return 'cancelled'
    default:
      return 'booked'
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function nameOfPerson(p: { firstName: string | null; lastName: string | null } | null): string {
  if (!p) return ''
  return `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()
}

export async function GET() {
  // Same default window as /api/timeline: −14 to +45 days from today.
  const today = new Date()
  const from = new Date(today); from.setDate(from.getDate() - 14); from.setUTCHours(0, 0, 0, 0)
  const to = new Date(today); to.setDate(to.getDate() + 45); to.setUTCHours(0, 0, 0, 0)

  // ── Bookings whose rental window overlaps [from, to], with all
  //    their items + assignments. Excludes archived. ──
  const bookings = await prisma.booking.findMany({
    where: {
      archivedAt: null,
      startDate: { lte: to },
      endDate: { gte: from },
    },
    select: {
      id: true,
      bookingNumber: true,
      jobName: true,
      productionName: true,
      startDate: true,
      endDate: true,
      status: true,
      rentalworksOrderId: true,
      company: { select: { id: true, name: true } },
      person: { select: { id: true, firstName: true, lastName: true } },
      agent: { select: { id: true, name: true } },
      adminNotes: true,
      items: {
        select: {
          id: true,
          quantity: true,
          status: true,
          holdRank: true,
          notes: true,
          category: { select: { id: true, name: true, slug: true } },
          assignments: {
            select: {
              id: true,
              startDate: true,
              endDate: true,
              status: true,
              asset: { select: { id: true, unitName: true, categoryId: true, tier: true } },
            },
          },
        },
      },
    },
    orderBy: { startDate: 'asc' },
  })

  // ── Build jobs[] — one per Booking. ──
  const jobs = bookings.map((b) => {
    const items = b.items.map((it) => {
      const cat = mapCategoryName(it.category?.name ?? '')
      // For multi-quantity items we render the FIRST assignment's
      // unit name into the jobs array (matches /api/timeline's
      // unit-per-line shape). The full assignment list is on
      // .assignments below if a caller wants it.
      const firstAssignment = it.assignments[0]
      return {
        cat,
        unit: firstAssignment?.asset.unitName ?? '(unassigned)',
        resourceName: it.category?.name ?? '',
        qty: it.quantity,
        start: ymd(b.startDate),
        end: ymd(b.endDate),
        reservationId: it.id, // BookingItem id stands in for Planyo reservation_id
        adminNotes: it.notes ?? '',
        holdRank: it.holdRank,
        status: it.status,
        assignments: it.assignments.map((a) => ({
          id: a.id,
          unit: a.asset.unitName,
          status: a.status,
          start: ymd(a.startDate),
          end: ymd(a.endDate),
        })),
      }
    })

    const firstCatKey = items[0] ? items[0].cat : 'general'
    const status = mapStatus(b.status)

    return {
      id: b.id,
      cartId: b.bookingNumber, // stable cross-source identifier
      bookingId: b.id, // explicit native id
      company: b.company.name,
      jobName: b.jobName,
      jobNum: b.bookingNumber,
      rwOrderNumber: b.rentalworksOrderId,
      contact: nameOfPerson(b.person),
      agent: b.agent.name ?? '',
      status,
      stage: status,
      startDate: ymd(b.startDate),
      endDate: ymd(b.endDate),
      color: CAT_COLORS[firstCatKey] ?? CAT_COLORS.general,
      productionName: b.productionName,
      items,
    }
  })

  // ── Build units[] — one per Asset that has at least one
  //    assignment overlapping the window. ──
  const assignments = await prisma.bookingAssignment.findMany({
    where: {
      status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
      startDate: { lte: to },
      endDate: { gte: from },
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      status: true,
      asset: { select: { id: true, unitName: true, categoryId: true, category: { select: { id: true, name: true } } } },
      bookingItem: {
        select: {
          id: true,
          status: true,
          holdRank: true,
          booking: {
            select: {
              id: true,
              bookingNumber: true,
              status: true,
              jobName: true,
              rentalworksOrderId: true,
              company: { select: { name: true } },
              agent: { select: { name: true } },
            },
          },
        },
      },
    },
  })

  const unitMap = new Map<string, { unitName: string; cat: string; resourceName: string; bookings: Array<Record<string, unknown>> }>()
  for (const a of assignments) {
    const unitName = a.asset.unitName
    const cat = mapCategoryName(a.asset.category?.name ?? '')
    const slot = unitMap.get(unitName) ?? {
      unitName,
      cat,
      resourceName: a.asset.category?.name ?? '',
      bookings: [] as Array<Record<string, unknown>>,
    }
    slot.bookings.push({
      reservationId: a.bookingItem.id, // BookingItem id (kept for /api/timeline parity)
      bookingItemId: a.bookingItem.id, // explicit name; preferred for action calls
      bookingId: a.bookingItem.booking.id, // for /confirm; previously omitted
      assignmentId: a.id,
      cartId: a.bookingItem.booking.bookingNumber,
      clientName: a.bookingItem.booking.company.name,
      jobName: a.bookingItem.booking.jobName,
      agent: a.bookingItem.booking.agent.name ?? '',
      rwOrderNumber: a.bookingItem.booking.rentalworksOrderId ?? null,
      resourceName: a.asset.category?.name ?? '',
      cat,
      status: mapStatus(a.bookingItem.booking.status),
      bookingStatus: a.bookingItem.booking.status, // raw enum so the UI can decide if Confirm is applicable
      start: ymd(a.startDate),
      end: ymd(a.endDate),
      adminNotes: '',
      qty: 1,
      holdRank: a.bookingItem.holdRank,
    })
    unitMap.set(unitName, slot)
  }

  const units = [...unitMap.values()]
    .map((u) => ({ ...u, bookings: u.bookings.sort((a, b) => String(a.start).localeCompare(String(b.start))) }))
    .sort((a, b) => {
      const catOrder = ['cube', 'cargo', 'pass', 'pop', 'cam', 'dlux', 'scout', 'studio', 'stakebed', 'general']
      const ca = catOrder.indexOf(a.cat); const cb = catOrder.indexOf(b.cat)
      if (ca !== cb) return ca - cb
      return a.unitName.localeCompare(b.unitName, undefined, { numeric: true })
    })

  return NextResponse.json({ ok: true, jobs, units, total: assignments.length, window: { from: ymd(from), to: ymd(to) } })
}
