/**
 * GET /api/dispatch?asOf=YYYY-MM-DD&days=N
 *
 * Phase 4 / commit 1 — read-only dispatch board selector. Single
 * Prisma round-trip; all bucketing happens in memory after fetch so
 * the prefer-assignment-date logic and the date-window predicate
 * stay in lockstep (no stale cards from a query/grouping skew).
 *
 * READ-ONLY by construction. Never writes OrderStatus, BookingStatus,
 * CadenceState, or any lifecycle field. No mutations of any kind.
 *
 * Buckets per the locked design:
 *   Outbound  (BOOKED | LOADED_READY):     effective_pickup ∈ horizon → day card
 *   Inbound   (ON_JOB):                    effective_return ∈ horizon → day card
 *   LateToShip   (BOOKED | LOADED_READY):  effective_pickup < today  → overdue
 *   LateToReturn (ON_JOB):                 effective_return < today  → overdue
 *
 * Skipped statuses: DRAFT, QUOTE_SENT, APPROVED, CANCELLED (not yet
 * on the board) and RETURNED, LD_CHECK, INVOICED, CLOSED (off the
 * board). STAGE-lane lines never appear.
 *
 * Effective date resolution:
 *   When the order has a linked Booking AND the line has an
 *   assetCategoryId AND exactly one BookingAssignment under that
 *   Booking matches the line's category, adopt that BA's startDate /
 *   endDate / asset.unitName for both display and bucketing. Multi-
 *   match (3 cargo van lines, 3 BAs) or zero-match falls back to the
 *   line's pickupDate / returnDate + the category name. Honest about
 *   the schema's lack of a formal OrderLineItem → BookingAssignment
 *   FK.
 *
 * Card shapes: FLEET = per OrderLineItem, WAREHOUSE = collapsed per
 * (order, effectivePickup). See FleetCard / WarehouseCard types.
 *
 * Response shape is uniform regardless of `days` so the UI can
 * iterate. days=2 (default) returns horizon with today + tomorrow;
 * days=14 returns a fortnight's worth.
 */

import { categoryNameForLine } from '@/lib/catalog/display'
import { NextRequest, NextResponse } from 'next/server'
import type { FulfillmentLane, OrderStatus, BookingPriority, PickListStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireReadSession } from '@/lib/scheduling/requireReadSession'

export const dynamic = 'force-dynamic'

const OUTBOUND_STATUSES: OrderStatus[] = ['BOOKED', 'LOADED_READY']
const INBOUND_STATUSES: OrderStatus[] = ['ON_JOB']
const ALL_LIVE_STATUSES: OrderStatus[] = [...OUTBOUND_STATUSES, ...INBOUND_STATUSES]

const DEFAULT_DAYS = 2
const MAX_DAYS = 30

// How far back a RESERVATION-derived movement may still count as
// overdue. The Planyo era left ~150 assignments whose rentals really
// came back but were never marked returned in HQ (nobody was working
// in HQ yet), and every one of them looks "late to return" forever.
// Showing the fleet 153 red cards on day one would burn the board's
// credibility, so overdue is bounded to the last week — what a human
// can still act on — and everything older is COUNTED, not hidden.
const RESERVATION_OVERDUE_DAYS = 7

// ─── Card shapes ────────────────────────────────────────────────
export interface FleetCard {
  kind: 'FLEET'
  // Stable id for React: line id, or `ba:<id>` for a reservation-derived card.
  cardId: string
  /** Where this card came from. 'reservation' cards are built straight
   *  from BookingAssignment rows — the truck movements the schedule
   *  knows about — and exist because most live work has no HQ order
   *  line (Planyo-imported bookings, RW-billed jobs). Before this the
   *  board could be empty while nine vehicles were due back. */
  source: 'order' | 'reservation'
  lineId: string | null
  orderId: string | null
  /** Present on reservation cards so the card can link somewhere useful. */
  jobId: string | null
  /** Order number, or the booking number for reservation cards. */
  orderNumber: string
  status: OrderStatus
  companyName: string
  jobName: string | null
  jobCode: string | null
  // The asset's unit name when an unambiguous BA matched; else null.
  assetUnitName: string | null
  // Category name from either the matched BA's category or the line's
  // assetCategory. Shown when assetUnitName is null.
  categoryName: string | null
  effectivePickupDate: string  // YYYY-MM-DD
  effectiveReturnDate: string  // YYYY-MM-DD
  // Surfaced badges per the locked MVP scope.
  priority: BookingPriority | null
  // Blind handoff flags from the parent Order. Light prep marker on
  // outbound when blindPickup; loud "needs check-in" alert on inbound
  // when blindReturn. Both auto-clear when the Order moves off the
  // board (BOOKED/LOADED_READY/ON_JOB → RETURNED/etc).
  blindPickup: boolean
  blindReturn: boolean
}

export interface WarehouseCard {
  kind: 'WAREHOUSE'
  // Stable id: `wh:<orderId>:<effectivePickupDate>` — collapses
  // multiple WAREHOUSE lines on the same order/date.
  cardId: string
  orderId: string
  orderNumber: string
  status: OrderStatus
  companyName: string
  jobName: string | null
  jobCode: string | null
  lineCount: number
  effectivePickupDate: string
  effectiveReturnDate: string
  // Per-order PickList state (Phase 2). Null when the order has no
  // pick list (shouldn't happen for a warehouse-routed order, but
  // defensive against post-book line edits — parking lot from Phase 2).
  pickListStatus: PickListStatus | null
  priority: BookingPriority | null
  blindPickup: boolean
  blindReturn: boolean
}

export type DispatchCard = FleetCard | WarehouseCard

export interface DispatchDay {
  // YYYY-MM-DD
  date: string
  // 'Today' | 'Tomorrow' | weekday label for the rest of the horizon.
  label: string
  outboundFleet: FleetCard[]
  outboundWarehouse: WarehouseCard[]
  inbound: DispatchCard[]
}

export interface DispatchPayload {
  asOfDate: string
  horizonDays: number
  overdue: {
    lateToShip: DispatchCard[]
    lateToReturn: DispatchCard[]
    /** Reservations whose return date passed more than
     *  RESERVATION_OVERDUE_DAYS ago and were never marked returned —
     *  Planyo-era leftovers. Counted, not listed. */
    staleUnreturned: number
  }
  days: DispatchDay[]
}

// ─── Helpers ────────────────────────────────────────────────────
function toYmd(d: Date): string {
  // The DB stores @db.Date so Prisma hands us a Date at UTC midnight
  // already; format directly off the UTC components to avoid TZ drift.
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseAsOf(raw: string | null): Date {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T00:00:00.000Z`)
  }
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000)
}

function labelFor(date: Date, asOf: Date): string {
  if (toYmd(date) === toYmd(asOf)) return 'Today'
  if (toYmd(date) === toYmd(addDays(asOf, 1))) return 'Tomorrow'
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// ─── Handler ────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // Any signed-in staff session (2026-08-23). This is READ-ONLY board
  // data — the same movements the Reservations board already shows
  // every role — and the Reservations "Out / Back" strip renders it
  // for sales too. Widened HERE and never inside requireDispatchAccess,
  // which still guards the BIT / dot-sheet paperwork surfaces as
  // fleet-only. Mutations elsewhere keep their own stricter gates.
  const denied = await requireReadSession()
  if (denied) return denied

  const url = req.nextUrl
  const asOf = parseAsOf(url.searchParams.get('asOf'))
  const daysParam = Number(url.searchParams.get('days') ?? DEFAULT_DAYS)
  const horizonDays = Number.isFinite(daysParam)
    ? Math.max(1, Math.min(MAX_DAYS, Math.floor(daysParam)))
    : DEFAULT_DAYS

  // ── Date window with ±1d buffer so the prefer-BA-date logic never
  // ── disagrees with the SQL filter at the boundaries. We bucket in
  // ── memory afterward.
  const windowStart = addDays(asOf, -90)  // overdue look-back; capped to keep query bounded
  const windowEnd = addDays(asOf, horizonDays + 1)

  // ── Single Prisma round-trip ─────────────────────────────────
  const rows = await prisma.orderLineItem.findMany({
    where: {
      fulfillmentLane: { in: ['FLEET', 'WAREHOUSE'] satisfies FulfillmentLane[] },
      order: { status: { in: ALL_LIVE_STATUSES } },
      OR: [
        { pickupDate: { gte: windowStart, lte: windowEnd } },
        { returnDate: { gte: windowStart, lte: windowEnd } },
      ],
    },
    select: {
      id: true,
      pickupDate: true,
      returnDate: true,
      fulfillmentLane: true,
      assetCategoryId: true,
      inventoryItemId: true,
      inventoryItem: { select: { id: true, description: true, trackingMode: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          // Blind handoff flags drive lane-side treatment. Loud red
          // "needs check-in" banner on inbound blindReturn cards
          // (clears via card disappearance when the Order transitions
          // to RETURNED — the existing return flow). Lighter prep
          // marker on outbound blindPickup cards.
          blindPickup: true,
          blindReturn: true,
          company: { select: { id: true, name: true } },
          job: { select: { id: true, jobCode: true, name: true } },
          pickList: { select: { id: true, status: true } },
          booking: {
            select: {
              id: true,
              bookingNumber: true,
              priority: true,
              items: {
                select: {
                  id: true,
                  categoryId: true,
                  catalogItemId: true,
                  assignments: {
                    select: {
                      id: true,
                      startDate: true,
                      endDate: true,
                      status: true,
                      asset: { select: { id: true, unitName: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  // ── Resolve effective dates + asset hint per line ────────────
  const today = toYmd(asOf)
  const horizonYmds = new Set<string>()
  for (let i = 0; i < horizonDays; i++) horizonYmds.add(toYmd(addDays(asOf, i)))

  type ResolvedLine = {
    line: (typeof rows)[number]
    pickupYmd: string
    returnYmd: string
    assetUnitName: string | null
    categoryName: string | null
    priority: BookingPriority | null
  }
  const resolved: ResolvedLine[] = rows.map((line) => {
    let pickupDate = line.pickupDate
    let returnDate = line.returnDate
    let assetUnitName: string | null = null
    let categoryName = categoryNameForLine(line)
    const priority = line.order.booking?.priority ?? null

    // Unambiguous BA match: same category, exactly one BA under this
    // Booking. Anything else falls back to line dates.
    if (line.inventoryItemId && line.order.booking) {
      const matchingBAs = line.order.booking.items
        .filter((bi) => bi.catalogItemId === line.inventoryItemId)
        .flatMap((bi) => bi.assignments)
      if (matchingBAs.length === 1) {
        pickupDate = matchingBAs[0].startDate
        returnDate = matchingBAs[0].endDate
        assetUnitName = matchingBAs[0].asset.unitName
        // Keep categoryName as a fallback for display.
      }
    }
    return {
      line,
      pickupYmd: toYmd(pickupDate),
      returnYmd: toYmd(returnDate),
      assetUnitName,
      categoryName,
      priority,
    }
  })

  // ── Build cards ──────────────────────────────────────────────
  function toFleetCard(r: ResolvedLine): FleetCard {
    const o = r.line.order as typeof r.line.order & { blindPickup?: boolean; blindReturn?: boolean }
    return {
      kind: 'FLEET',
      cardId: r.line.id,
      source: 'order',
      lineId: r.line.id,
      orderId: r.line.order.id,
      jobId: r.line.order.job?.id ?? null,
      orderNumber: r.line.order.orderNumber,
      status: r.line.order.status,
      companyName: r.line.order.company.name,
      jobName: r.line.order.job?.name ?? null,
      jobCode: r.line.order.job?.jobCode ?? null,
      assetUnitName: r.assetUnitName,
      categoryName: r.categoryName,
      effectivePickupDate: r.pickupYmd,
      effectiveReturnDate: r.returnYmd,
      priority: r.priority,
      blindPickup: !!o.blindPickup,
      blindReturn: !!o.blindReturn,
    }
  }

  // WAREHOUSE rows collapse per (order, effectivePickupDate). The
  // returnDate on the card is the max return date across collapsed
  // lines — that's the latest moment the operator cares about for
  // "when does this load come back."
  const warehouseGroups = new Map<
    string,
    { rows: ResolvedLine[]; pickupYmd: string; returnYmd: string }
  >()
  for (const r of resolved) {
    if (r.line.fulfillmentLane !== 'WAREHOUSE') continue
    const key = `${r.line.order.id}:${r.pickupYmd}`
    const cur = warehouseGroups.get(key) ?? {
      rows: [],
      pickupYmd: r.pickupYmd,
      returnYmd: r.returnYmd,
    }
    cur.rows.push(r)
    if (r.returnYmd > cur.returnYmd) cur.returnYmd = r.returnYmd
    warehouseGroups.set(key, cur)
  }
  function toWarehouseCard(key: string, g: { rows: ResolvedLine[]; pickupYmd: string; returnYmd: string }): WarehouseCard {
    const head = g.rows[0].line
    const ho = head.order as typeof head.order & { blindPickup?: boolean; blindReturn?: boolean }
    return {
      kind: 'WAREHOUSE',
      cardId: `wh:${key}`,
      orderId: head.order.id,
      orderNumber: head.order.orderNumber,
      status: head.order.status,
      companyName: head.order.company.name,
      jobName: head.order.job?.name ?? null,
      jobCode: head.order.job?.jobCode ?? null,
      lineCount: g.rows.length,
      effectivePickupDate: g.pickupYmd,
      effectiveReturnDate: g.returnYmd,
      pickListStatus: head.order.pickList?.status ?? null,
      priority: g.rows[0].priority,
      blindPickup: !!ho.blindPickup,
      blindReturn: !!ho.blindReturn,
    }
  }

  // ── Reservation-derived movements ────────────────────────────
  // The board used to read ONLY order line items, so a truck with a
  // reservation but no HQ order line was invisible — which on
  // 2026-08-23 meant 11 real movements in three days and an empty
  // board. BookingAssignment is what the schedule actually knows, so
  // it is the primary source here; order lines still bring warehouse
  // pick-lists and blind-handoff flags.
  const assignments = await prisma.bookingAssignment.findMany({
    where: {
      status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
      OR: [
        { startDate: { gte: windowStart, lte: windowEnd } },
        { endDate: { gte: windowStart, lte: windowEnd } },
      ],
      bookingItem: { booking: { status: { in: ['CONFIRMED', 'ACTIVE'] } } },
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      status: true,
      asset: { select: { unitName: true } },
      bookingItem: {
        select: {
          category: { select: { name: true } },
          booking: {
            select: {
              id: true,
              bookingNumber: true,
              jobName: true,
              priority: true,
              status: true,
              company: { select: { name: true } },
              job: { select: { id: true, jobCode: true } },
            },
          },
        },
      },
    },
  })

  const reservationCards: FleetCard[] = assignments.map((a) => {
    const b = a.bookingItem.booking
    return {
      kind: 'FLEET' as const,
      cardId: `ba:${a.id}`,
      source: 'reservation' as const,
      lineId: null,
      orderId: null,
      jobId: b.job?.id ?? null,
      orderNumber: b.bookingNumber,
      // Honest status: out on the road once checked out, otherwise the
      // booking's own state. Bucketing below keys on DATES, not this —
      // a CONFIRMED booking that was never marked checked out still has
      // to appear on the day it comes back.
      status: (a.status === 'CHECKED_OUT' || b.status === 'ACTIVE' ? 'ON_JOB' : 'BOOKED') as OrderStatus,
      companyName: b.company.name,
      jobName: b.jobName,
      jobCode: b.job?.jobCode ?? null,
      assetUnitName: a.asset.unitName,
      categoryName: a.bookingItem.category?.name ?? null,
      effectivePickupDate: toYmd(a.startDate),
      effectiveReturnDate: toYmd(a.endDate),
      priority: b.priority,
      // Blind-handoff flags live on Orders; a reservation-only movement
      // has none to read.
      blindPickup: false,
      blindReturn: false,
    }
  })

  // Bookings now represented unit-by-unit. Their FLEET order lines are
  // suppressed so one movement isn't listed twice — the assignment card
  // names the actual unit, the line only names a category. WAREHOUSE
  // cards are untouched: they're about picking a load, not a vehicle.
  const bookingsCoveredByReservations = new Set(
    assignments.map((a) => a.bookingItem.booking.id),
  )

  // Pre-emit fleet cards by their effective pickup date for outbound
  // bucketing. Inbound bucketing uses effective return date.
  const allFleetCards = [
    ...resolved
      .filter((r) => r.line.fulfillmentLane === 'FLEET')
      .filter((r) => !(r.line.order.booking && bookingsCoveredByReservations.has(r.line.order.booking.id)))
      .map(toFleetCard),
    ...reservationCards,
  ]
  const allWarehouseCards = Array.from(warehouseGroups.entries()).map(([k, g]) => toWarehouseCard(k, g))

  // ── Bucket ───────────────────────────────────────────────────
  const days: DispatchDay[] = []
  for (let i = 0; i < horizonDays; i++) {
    const date = addDays(asOf, i)
    const ymd = toYmd(date)
    days.push({
      date: ymd,
      label: labelFor(date, asOf),
      // Reservation cards bucket on DATES alone: a booking that was
      // never marked checked out still goes out and comes back, and
      // order-status semantics don't apply to it.
      outboundFleet: allFleetCards.filter(
        (c) =>
          c.effectivePickupDate === ymd &&
          (c.source === 'reservation' || OUTBOUND_STATUSES.includes(c.status)),
      ),
      outboundWarehouse: allWarehouseCards.filter(
        (c) => OUTBOUND_STATUSES.includes(c.status) && c.effectivePickupDate === ymd,
      ),
      inbound: [
        ...allFleetCards.filter(
          (c) =>
            c.effectiveReturnDate === ymd &&
            (c.source === 'reservation' || INBOUND_STATUSES.includes(c.status)),
        ),
        ...allWarehouseCards.filter(
          (c) => INBOUND_STATUSES.includes(c.status) && c.effectiveReturnDate === ymd,
        ),
      ],
    })
  }

  const overdueFloor = toYmd(addDays(asOf, -RESERVATION_OVERDUE_DAYS))
  // Never-closed-out rentals older than the window. Reported so the
  // board can say so out loud instead of silently dropping them.
  const staleUnreturned = allFleetCards.filter(
    (c) => c.source === 'reservation' && c.effectiveReturnDate < overdueFloor,
  ).length

  const overdue = {
    lateToShip: [
      ...allFleetCards.filter(
        (c) =>
          c.effectivePickupDate < today &&
          (c.source === 'reservation'
            ? // Should be out RIGHT NOW and isn't: pickup passed, return
              // still ahead, not checked out — and recent enough to act on.
              c.status !== 'ON_JOB' &&
              c.effectiveReturnDate >= today &&
              c.effectivePickupDate >= overdueFloor
            : OUTBOUND_STATUSES.includes(c.status)),
      ),
      ...allWarehouseCards.filter(
        (c) => OUTBOUND_STATUSES.includes(c.status) && c.effectivePickupDate < today,
      ),
    ],
    lateToReturn: [
      ...allFleetCards.filter(
        (c) =>
          c.effectiveReturnDate < today &&
          (c.source === 'reservation'
            ? c.effectiveReturnDate >= overdueFloor
            : INBOUND_STATUSES.includes(c.status)),
      ),
      ...allWarehouseCards.filter(
        (c) => INBOUND_STATUSES.includes(c.status) && c.effectiveReturnDate < today,
      ),
    ],
    staleUnreturned,
  }

  const payload: DispatchPayload = {
    asOfDate: today,
    horizonDays,
    overdue,
    days,
  }
  return NextResponse.json(payload)
}
