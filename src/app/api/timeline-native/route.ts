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
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// Parse a YYYY-MM-DD string into a UTC midnight Date, or null. Anything
// non-ISO returns null and the caller falls back to its default.
function parseYmd(s: string | null): Date | null {
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return null
  return d
}

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

export async function GET(req: NextRequest) {
  // Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD. The /gantt page passes
  // these when the operator pans the window past the default; the
  // legacy callers (/calendar, /dashboard) keep working unchanged
  // because we fall back to the today-14/today+45 default below.
  // Bounds-checked to keep a single rogue query from scanning the
  // full Booking table — a 365-day max forward reach is plenty for
  // an interactive timeline.
  const { searchParams } = new URL(req.url)
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const fromParam = parseYmd(searchParams.get('from'))
  const toParam = parseYmd(searchParams.get('to'))

  const defaultFrom = new Date(today); defaultFrom.setDate(defaultFrom.getDate() - 14)
  const defaultTo = new Date(today); defaultTo.setDate(defaultTo.getDate() + 45)

  // Clamp custom range to ±365d from today to bound the query.
  const minAllowed = new Date(today); minAllowed.setDate(minAllowed.getDate() - 365)
  const maxAllowed = new Date(today); maxAllowed.setDate(maxAllowed.getDate() + 365)
  const clamp = (d: Date) => (d < minAllowed ? minAllowed : d > maxAllowed ? maxAllowed : d)

  const from = fromParam ? clamp(fromParam) : defaultFrom
  let to = toParam ? clamp(toParam) : defaultTo
  // Defensive: a single mis-ordered pair (to before from) silently
  // clipping the result set is worse than just enlarging to a 1-week
  // window from `from` and returning data.
  if (to < from) {
    to = new Date(from); to.setDate(to.getDate() + 7)
  }

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
      // Native Job linkage (Booking.jobId FK, added in the JobPicker
      // commit). NULL on legacy/Planyo-imported Bookings — the UI
      // hides the "Open job →" affordance when jobId is null.
      // job.orders: orders live on the JOB (Order.jobId is required;
      // Order.bookingId is unused in practice — zero rows carry it),
      // so the booking's orders are its job's orders.
      job: {
        select: {
          id: true,
          jobCode: true,
          orders: {
            where: { status: { not: 'CANCELLED' } },
            select: { id: true, orderNumber: true, status: true },
          },
        },
      },
      company: { select: { id: true, name: true } },
      person: { select: { id: true, firstName: true, lastName: true } },
      agent: { select: { id: true, name: true } },
      // Linked Order(s) — id/number/status feed the clickable order
      // links in the reservation detail + the 📄 bar indicator;
      // blindPickup keeps its existing "any order flagged" semantics.
      orders: { select: { id: true, orderNumber: true, status: true, blindPickup: true } },
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

  // ── Per-booking extras: orders (clickable in detail panels) and the
  //    full assigned-unit list ("which asset is the order loaded onto" /
  //    sibling reservations). Derived from the bookings query above and
  //    joined into units[].bookings by bookingId. ──
  const bookingExtras = new Map<
    string,
    {
      orders: Array<{ id: string; orderNumber: string; status: string }>
      units: Array<{ unitName: string; category: string; bookingNumber: string }>
    }
  >()
  // A Job's units frequently span MULTIPLE bookings (e.g. "Hills": two
  // bookings, one Cube each), so sibling units are computed at the JOB
  // level — every assigned unit across all of the job's bookings, with
  // the booking number carried for context. Job-less bookings fall back
  // to their own booking's units.
  const jobUnits = new Map<string, Array<{ unitName: string; category: string; bookingNumber: string }>>()
  for (const b of bookings) {
    if (!b.job?.id) continue
    const arr = jobUnits.get(b.job.id) ?? []
    for (const it of b.items) {
      for (const a of it.assignments) {
        arr.push({ unitName: a.asset.unitName, category: it.category?.name ?? '', bookingNumber: b.bookingNumber })
      }
    }
    jobUnits.set(b.job.id, arr)
  }

  for (const b of bookings) {
    // Union of the job's orders (the real linkage) and any directly
    // booking-linked orders, deduped by id.
    const orderById = new Map<string, { id: string; orderNumber: string; status: string }>()
    for (const o of b.job?.orders ?? []) orderById.set(o.id, { id: o.id, orderNumber: o.orderNumber, status: o.status })
    for (const o of b.orders) orderById.set(o.id, { id: o.id, orderNumber: o.orderNumber, status: o.status })
    const ownUnits = b.items.flatMap((it) =>
      it.assignments.map((a) => ({ unitName: a.asset.unitName, category: it.category?.name ?? '', bookingNumber: b.bookingNumber })),
    )
    bookingExtras.set(b.id, {
      orders: [...orderById.values()],
      units: b.job?.id ? jobUnits.get(b.job.id) ?? ownUnits : ownUnits,
    })
  }

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
      jobId: b.job?.id ?? null,
      jobCode: b.job?.jobCode ?? null,
      company: b.company.name,
      jobName: b.jobName,
      jobNum: b.bookingNumber,
      rwOrderNumber: b.rentalworksOrderId,
      contact: nameOfPerson(b.person),
      agent: b.agent.name ?? '',
      status,
      stage: status,
      blindPickup: b.orders.some((o) => o.blindPickup),
      // Clickable order links for the job detail modal; hasOrder drives
      // the 📄 indicator on job-view bars. Sourced via the Job join
      // (see bookingExtras above).
      orders: bookingExtras.get(b.id)?.orders ?? [],
      hasOrder: (bookingExtras.get(b.id)?.orders.length ?? 0) > 0,
      // Units on the same JOB but on other bookings — a job's fleet
      // often spans multiple bookings (one per unit).
      otherJobUnits: (b.job?.id ? jobUnits.get(b.job.id) ?? [] : []).filter(
        (u) => u.bookingNumber !== b.bookingNumber,
      ),
      startDate: ymd(b.startDate),
      endDate: ymd(b.endDate),
      color: CAT_COLORS[firstCatKey] ?? CAT_COLORS.general,
      productionName: b.productionName,
      items,
    }
  })

  // ── Build units[] — the FULL active fleet roster, assignments
  //    overlaid as bars. An idle unit is an EMPTY ROW, not an absent
  //    one — empty rows are what dispatch scans for availability
  //    (origin: 2026-07-15, Oliver reported idle Cubes/Cargos/Pass
  //    vans missing from the calendar because rows were derived from
  //    assignments only). INACTIVE (isActive=false, out-of-fleet)
  //    units are NOT listed at all (Wes 2026-07-16); whether a listed
  //    unit is on a job right now is shown by the unit-name cell
  //    color + the bars in its row, not by membership. Category gate
  //    is reservableOnGantt so TEST rigs stay off. Keyed by assetId,
  //    NOT unitName — "Cargo 22"/"Cargo 25" exist as distinct assets
  //    in BOTH cargo categories and must not collapse into one row. ──
  const rosterAssets = await prisma.asset.findMany({
    where: { isActive: true, category: { reservableOnGantt: true } },
    select: {
      id: true,
      unitName: true,
      categoryId: true,
      tier: true,
      category: { select: { id: true, name: true } },
    },
  })

  const assignments = await prisma.bookingAssignment.findMany({
    where: {
      status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
      startDate: { lte: to },
      endDate: { gte: from },
      // Out-of-fleet units (isActive=false) are not listed on the board;
      // their assignment history stays in the DB (Fleet's Inactive tab).
      asset: { isActive: true },
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      status: true,
      asset: { select: { id: true, unitName: true, categoryId: true, tier: true, category: { select: { id: true, name: true } } } },
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
              job: { select: { id: true, jobCode: true } },
              company: { select: { name: true } },
              agent: { select: { id: true, name: true } },
              orders: { select: { blindPickup: true } },
            },
          },
        },
      },
    },
  })

  const unitMap = new Map<
    string,
    {
      unitName: string
      assetId: string
      categoryId: string
      cat: string
      tier: string
      resourceName: string
      bookings: Array<Record<string, unknown>>
    }
  >()
  // Seed every roster unit as an (initially empty) row.
  for (const r of rosterAssets) {
    unitMap.set(r.id, {
      unitName: r.unitName,
      assetId: r.id, // needed by gantt row-click → +Hold flow (asset binding)
      categoryId: r.categoryId, // needed by gantt row-click → +Hold flow (modal category prop)
      cat: mapCategoryName(r.category?.name ?? ''),
      tier: r.tier, // condition tier → gantt dot color (Best/Good/Workhorse)
      resourceName: r.category?.name ?? '',
      bookings: [] as Array<Record<string, unknown>>,
    })
  }
  for (const a of assignments) {
    const cat = mapCategoryName(a.asset.category?.name ?? '')
    // Assigned unit outside the roster (e.g. non-reservable category)
    // still gets its row — an existing booking must never disappear.
    const slot = unitMap.get(a.asset.id) ?? {
      unitName: a.asset.unitName,
      assetId: a.asset.id,
      categoryId: a.asset.categoryId,
      cat,
      tier: a.asset.tier,
      resourceName: a.asset.category?.name ?? '',
      bookings: [] as Array<Record<string, unknown>>,
    }
    slot.bookings.push({
      reservationId: a.bookingItem.id, // BookingItem id (kept for /api/timeline parity)
      bookingItemId: a.bookingItem.id, // explicit name; preferred for action calls
      bookingId: a.bookingItem.booking.id, // for /confirm; previously omitted
      assignmentId: a.id,
      cartId: a.bookingItem.booking.bookingNumber,
      jobId: a.bookingItem.booking.job?.id ?? null,
      jobCode: a.bookingItem.booking.job?.jobCode ?? null,
      clientName: a.bookingItem.booking.company.name,
      jobName: a.bookingItem.booking.jobName,
      agent: a.bookingItem.booking.agent.name ?? '',
      agentId: a.bookingItem.booking.agent?.id ?? null, // owner — gates the sales status control
      rwOrderNumber: a.bookingItem.booking.rentalworksOrderId ?? null,
      resourceName: a.asset.category?.name ?? '',
      cat,
      status: mapStatus(a.bookingItem.booking.status),
      bookingStatus: a.bookingItem.booking.status, // raw enum so the UI can decide if Confirm is applicable
      blindPickup: a.bookingItem.booking.orders.some((o) => o.blindPickup),
      start: ymd(a.startDate),
      end: ymd(a.endDate),
      adminNotes: '',
      qty: 1,
      holdRank: a.bookingItem.holdRank,
      // Job context for the reservation detail: clickable orders (with
      // hasOrder driving the 📄 bar indicator) and the JOB's other
      // assigned units — across ALL of the job's bookings, not just
      // this one. Only this bar's own (unit, booking) entry is
      // excluded, so the same unit on another booking still shows.
      orders: bookingExtras.get(a.bookingItem.booking.id)?.orders ?? [],
      hasOrder: (bookingExtras.get(a.bookingItem.booking.id)?.orders.length ?? 0) > 0,
      siblingUnits: (bookingExtras.get(a.bookingItem.booking.id)?.units ?? []).filter(
        (u) => !(u.unitName === a.asset.unitName && u.bookingNumber === a.bookingItem.booking.bookingNumber),
      ),
    })
    unitMap.set(a.asset.id, slot)
  }

  // ── Unit N/A (out-of-service) — OPEN MaintenanceRecord windows (SCHEDULED /
  //    IN_PROGRESS; not COMPLETED/CANCELLED) overlapping the visible range,
  //    keyed by assetId, rendered as grey bars. endDate null = open-ended.
  //    `kind` distinguishes a sales referral (pending fleet review) from a
  //    fleet-confirmed / genuine out-of-service record (title-tagged — no
  //    schema field). Booking-less N/A units get their OWN unit row here so
  //    they're visible + clearable even with nothing booked. Display-only —
  //    does NOT touch booking/assign availability. ──
  const naByAsset = new Map<
    string,
    Array<{ recordId: string; start: string; end: string | null; kind: 'referral' | 'fleet'; title: string }>
  >()
  const naMaint = await prisma.maintenanceRecord.findMany({
    where: {
      status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
      startDate: { lte: to },
      OR: [{ endDate: null }, { endDate: { gte: from } }],
      // Same out-of-fleet exclusion as the roster.
      asset: { isActive: true },
    },
    select: {
      id: true,
      title: true,
      startDate: true,
      endDate: true,
      asset: { select: { id: true, unitName: true, categoryId: true, tier: true, category: { select: { name: true } } } },
    },
    orderBy: { startDate: 'asc' },
  })
  for (const m of naMaint) {
    if (!m.asset) continue
    const kind: 'referral' | 'fleet' = /referral|pending fleet review/i.test(m.title) ? 'referral' : 'fleet'
    const arr = naByAsset.get(m.asset.id) ?? []
    arr.push({ recordId: m.id, start: ymd(m.startDate), end: m.endDate ? ymd(m.endDate) : null, kind, title: m.title })
    naByAsset.set(m.asset.id, arr)
    // Surface a booking-less out-of-service unit as its own row (only
    // relevant for units outside the roster — roster rows already exist).
    if (!unitMap.has(m.asset.id)) {
      unitMap.set(m.asset.id, {
        unitName: m.asset.unitName,
        assetId: m.asset.id,
        categoryId: m.asset.categoryId,
        cat: mapCategoryName(m.asset.category?.name ?? ''),
        tier: m.asset.tier,
        resourceName: m.asset.category?.name ?? '',
        bookings: [],
      })
    }
  }

  const units = [...unitMap.values()]
    .map((u) => ({ ...u, naWindows: naByAsset.get(u.assetId) ?? [], bookings: u.bookings.sort((a, b) => String(a.start).localeCompare(String(b.start))) }))
    .sort((a, b) => {
      const catOrder = ['cube', 'cargo', 'pass', 'pop', 'cam', 'dlux', 'scout', 'studio', 'stakebed', 'general']
      const ca = catOrder.indexOf(a.cat); const cb = catOrder.indexOf(b.cat)
      if (ca !== cb) return ca - cb
      return a.unitName.localeCompare(b.unitName, undefined, { numeric: true })
    })

  // ── Needs-Assignment lane — DELIVERY/PICKUP TASKS awaiting fleet. ──
  //    Vehicles are intentionally NOT in this lane (Planyo backfill = every
  //    imported BookingItem is unassigned noise). It now surfaces the
  //    sales-created delivery/pickup DispatchTasks that still need a fleet
  //    assignment: PENDING, in the visible window by scheduledDate, and NOT
  //    yet given a tow vehicle. Assigning a tow vehicle (fleet action) drops
  //    the task from this lane. Read-only here — assignment is a separate,
  //    canAssignAssets-gated endpoint.
  const taskRows = await prisma.dispatchTask.findMany({
    where: {
      type: { in: ['DELIVERY', 'PICKUP'] },
      status: 'PENDING',
      towVehicle: null,
      scheduledDate: { gte: from, lte: to },
    },
    select: {
      id: true, type: true, scheduledDate: true, scheduledTime: true,
      siteAddress: true, deliveryItems: true,
      order: { select: { orderNumber: true, company: { select: { name: true } }, job: { select: { name: true, jobCode: true } } } },
      booking: { select: { jobName: true, company: { select: { name: true } } } },
    },
    orderBy: { scheduledDate: 'asc' },
  })
  const unassignedHolds = taskRows.map((t) => {
    const day = ymd(t.scheduledDate)
    return {
      kind: 'task' as const,
      taskId: t.id,
      taskType: t.type, // 'DELIVERY' | 'PICKUP'
      // cat lets the gantt's category filter treat tasks distinctly; they show
      // in the default "All Categories" view.
      cat: t.type === 'DELIVERY' ? 'delivery' : 'pickup',
      start: day,
      end: day,
      scheduledTime: t.scheduledTime ?? '',
      siteAddress: t.siteAddress ?? '',
      deliveryItems: t.deliveryItems ?? '',
      // Standalone tasks have no order/booking — fall back to the site address
      // so the lane label reads "Delivery · <site>" rather than a blank dash.
      clientName: t.order?.company?.name ?? t.booking?.company?.name ?? t.siteAddress ?? '—',
      jobName: t.order?.job?.name ?? t.booking?.jobName ?? t.order?.orderNumber ?? '',
    }
  })

  return NextResponse.json({
    ok: true,
    jobs,
    units,
    unassignedHolds,
    total: assignments.length,
    window: { from: ymd(from), to: ymd(to) },
  })
}
