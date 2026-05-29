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

import { NextRequest, NextResponse } from 'next/server'
import type { FulfillmentLane, OrderStatus, BookingPriority, PickListStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireDispatchAccess } from '@/lib/fleet/requireDispatchAccess'

export const dynamic = 'force-dynamic'

const OUTBOUND_STATUSES: OrderStatus[] = ['BOOKED', 'LOADED_READY']
const INBOUND_STATUSES: OrderStatus[] = ['ON_JOB']
const ALL_LIVE_STATUSES: OrderStatus[] = [...OUTBOUND_STATUSES, ...INBOUND_STATUSES]

const DEFAULT_DAYS = 2
const MAX_DAYS = 30

// ─── Card shapes ────────────────────────────────────────────────
export interface FleetCard {
  kind: 'FLEET'
  // Stable id for React: line id OR (when a BA was adopted) `ba:<id>`.
  cardId: string
  lineId: string
  orderId: string
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
  const auth = await requireDispatchAccess()
  if (!auth.ok) return auth.response

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
      assetCategory: { select: { id: true, name: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
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
    let categoryName = line.assetCategory?.name ?? null
    const priority = line.order.booking?.priority ?? null

    // Unambiguous BA match: same category, exactly one BA under this
    // Booking. Anything else falls back to line dates.
    if (line.assetCategoryId && line.order.booking) {
      const matchingBAs = line.order.booking.items
        .filter((bi) => bi.categoryId === line.assetCategoryId)
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
    return {
      kind: 'FLEET',
      cardId: r.line.id,
      lineId: r.line.id,
      orderId: r.line.order.id,
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
    }
  }

  // Pre-emit fleet cards by their effective pickup date for outbound
  // bucketing. Inbound bucketing uses effective return date.
  const allFleetCards = resolved
    .filter((r) => r.line.fulfillmentLane === 'FLEET')
    .map(toFleetCard)
  const allWarehouseCards = Array.from(warehouseGroups.entries()).map(([k, g]) => toWarehouseCard(k, g))

  // ── Bucket ───────────────────────────────────────────────────
  const days: DispatchDay[] = []
  for (let i = 0; i < horizonDays; i++) {
    const date = addDays(asOf, i)
    const ymd = toYmd(date)
    days.push({
      date: ymd,
      label: labelFor(date, asOf),
      outboundFleet: allFleetCards.filter(
        (c) => OUTBOUND_STATUSES.includes(c.status) && c.effectivePickupDate === ymd,
      ),
      outboundWarehouse: allWarehouseCards.filter(
        (c) => OUTBOUND_STATUSES.includes(c.status) && c.effectivePickupDate === ymd,
      ),
      inbound: [
        ...allFleetCards.filter(
          (c) => INBOUND_STATUSES.includes(c.status) && c.effectiveReturnDate === ymd,
        ),
        ...allWarehouseCards.filter(
          (c) => INBOUND_STATUSES.includes(c.status) && c.effectiveReturnDate === ymd,
        ),
      ],
    })
  }

  const overdue = {
    lateToShip: [
      ...allFleetCards.filter(
        (c) => OUTBOUND_STATUSES.includes(c.status) && c.effectivePickupDate < today,
      ),
      ...allWarehouseCards.filter(
        (c) => OUTBOUND_STATUSES.includes(c.status) && c.effectivePickupDate < today,
      ),
    ],
    lateToReturn: [
      ...allFleetCards.filter(
        (c) => INBOUND_STATUSES.includes(c.status) && c.effectiveReturnDate < today,
      ),
      ...allWarehouseCards.filter(
        (c) => INBOUND_STATUSES.includes(c.status) && c.effectiveReturnDate < today,
      ),
    ],
  }

  const payload: DispatchPayload = {
    asOfDate: today,
    horizonDays,
    overdue,
    days,
  }
  return NextResponse.json(payload)
}
