/**
 * GET /api/scheduling/booking-items/[id]/available-units
 *
 * Query: bufferDays, plus the DATE BLOCK being filled — `orderId` and an
 * optional `start` / `end` (YYYY-MM-DD). The states in this list are only
 * as true as the window they were computed for: until 2026-09-14 this
 * route used the booking envelope while the assign route used the order
 * span, so the picker could render a van "tight" and the Assign button
 * refuse it as a hard overlap on the same screen (Oliver, ADV Carrera).
 * Both now call `resolveAssignWindow`.
 *
 * Chunk 5 of native-scheduling-v1-brief.md — assignment picker
 * source. Returns the assignable units for a BookingItem, sorted by
 * `tier` (nicest first), with each unit's current per-window state
 * (free | buffer | booked). Also returns the current assignments
 * so the UI can render "X of Y assigned" progress.
 *
 * The unit list is filtered to remove already-assigned units of this
 * BookingItem so the picker doesn't show duplicates.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCategoryAvailability } from '@/lib/scheduling/availability'
import type { AssetTier } from '@prisma/client'
import { requireReadSession } from '@/lib/scheduling/requireReadSession'
import { deriveOrderWindow } from '@/lib/jobs/dateRange'
import { coverageOfBlock, quotedBlocks, resolveAssignWindow } from '@/lib/scheduling/assignWindow'
import { quotedLinesForHold } from '@/lib/scheduling/quotedLines'

export const dynamic = 'force-dynamic'

const TIER_ORDER: Record<AssetTier, number> = {
  PREMIUM: 0,
  STANDARD: 1,
  ECONOMY: 2,
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const denied = await requireReadSession()
  if (denied) return denied

  const bookingItem = await prisma.bookingItem.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      categoryId: true,
      quantity: true,
      status: true,
      holdRank: true,
      booking: {
        select: { id: true, bookingNumber: true, jobName: true, jobId: true, startDate: true, endDate: true },
      },
      category: { select: { name: true, slug: true } },
      assignments: {
        select: { id: true, assetId: true, status: true, startDate: true, endDate: true },
      },
    },
  })
  if (!bookingItem) return NextResponse.json({ error: 'booking item not found' }, { status: 404 })

  const url = new URL(_req.url)
  const bufferDays = parseInt(url.searchParams.get('bufferDays') ?? '1', 10) || 1
  const parseDay = (s: string | null): Date | null =>
    s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : null

  // ── The days being filled ─────────────────────────────────────────
  const liveOrders = await prisma.order.findMany({
    where: { jobId: bookingItem.booking.jobId ?? undefined, status: { notIn: ['CANCELLED'] }, archivedAt: null },
    select: { id: true, orderNumber: true, status: true },
    orderBy: { createdAt: 'asc' },
  })
  const askedOrderId = url.searchParams.get('orderId')
  const activeOrderId =
    askedOrderId && liveOrders.some((o) => o.id === askedOrderId)
      ? askedOrderId
      : liveOrders.length === 1
        ? liveOrders[0].id
        : null
  const orderForWindow = activeOrderId
    ? await prisma.order.findUnique({
        where: { id: activeOrderId },
        select: {
          startDate: true,
          endDate: true,
          lineItems: { select: { pickupDate: true, returnDate: true } },
          booking: { select: { startDate: true, endDate: true, status: true } },
        },
      })
    : null
  const orderWindow = orderForWindow ? deriveOrderWindow({ ...orderForWindow, job: { bookings: [] } }) : null
  const liveAssignments = bookingItem.assignments.filter((a) => a.status === 'ASSIGNED' || a.status === 'CHECKED_OUT')
  const blocks = quotedBlocks(
    await quotedLinesForHold({
      categoryId: bookingItem.categoryId,
      jobId: bookingItem.booking.jobId,
      orderId: activeOrderId,
    }),
  )
  const window = resolveAssignWindow({
    hold: { start: bookingItem.booking.startDate, end: bookingItem.booking.endDate },
    orderWindow,
    blocks,
    assignments: liveAssignments,
    requested: { start: parseDay(url.searchParams.get('start')), end: parseDay(url.searchParams.get('end')) },
  })

  const activeBlock =
    blocks.find(
      (b) => b.start.getTime() === window.start.getTime() && b.end.getTime() === window.end.getTime(),
    ) ?? null

  // Exclude THIS booking item's own assignments + pending demand so the
  // unit it's already on isn't counted as a conflict against itself and the
  // pooled summary reflects true remaining capacity for the edit.
  const availability = await getCategoryAvailability(
    bookingItem.categoryId,
    window.start,
    window.end,
    bufferDays,
    bookingItem.id,
  )

  // Only units already on this hold FOR THESE DAYS are duplicates. One
  // bound to another date block of the same hold is a legitimate pick for
  // this one — hiding it is how a second block ends up with no truck.
  const assignedAssetIds = new Set(
    liveAssignments.filter((a) => a.startDate <= window.end && a.endDate >= window.start).map((a) => a.assetId),
  )

  // Pull asset tier alongside each unit by joining assignments back to
  // assets. The pure engine's `units` already carries `tier`; we just
  // filter and sort.
  const candidates = availability.units
    .filter((u) => !assignedAssetIds.has(u.assetId))
    .sort((a, b) => {
      const t = TIER_ORDER[a.tier] - TIER_ORDER[b.tier]
      if (t !== 0) return t
      return a.unitName.localeCompare(b.unitName, undefined, { numeric: true })
    })

  // Look up current assignment metadata for display.
  const currentAssignments = bookingItem.assignments.length
    ? await prisma.bookingAssignment.findMany({
        where: { id: { in: bookingItem.assignments.map((a) => a.id) } },
        select: {
          id: true,
          status: true,
          startDate: true,
          endDate: true,
          asset: { select: { id: true, unitName: true, tier: true } },
          // Which order THIS unit is going out on (Hugo, 2026-09-03).
          order: { select: { id: true, orderNumber: true } },
        },
      })
    : []

  // The order this booking is tied to (if any) — the DOT-sheet action and
  // the client portal are Order-scoped.
  const order = await prisma.order.findFirst({ where: { bookingId: bookingItem.booking.id }, select: { id: true } })

  // WHAT WAS QUOTED against this hold (Wes 2026-09-01: "it should tell
  // the agent what was quoted and the dates"). Assigning a unit is a
  // promise about a specific line on a specific quote, and the modal
  // showed only a category name — so the agent had to leave, open the
  // order, and remember the dates.
  //
  // Matched the same way holdOnQuoteSend created the hold: a line points
  // at this category either directly (legacy assetCategoryId) or through
  // its catalog row's legacyAssetCategoryId. Line dates are returned
  // rather than the booking window because a line may legitimately
  // differ from it, and the line is what the client was quoted.
  const quotedLines = await prisma.orderLineItem.findMany({
    where: {
      order: {
        jobId: bookingItem.booking.jobId ?? undefined,
        status: { notIn: ['CANCELLED'] },
        archivedAt: null,
      },
      OR: [
        { assetCategoryId: bookingItem.categoryId },
        { inventoryItem: { legacyAssetCategoryId: bookingItem.categoryId } },
      ],
    },
    select: {
      id: true,
      description: true,
      quantity: true,
      rate: true,
      rateType: true,
      billableDays: true,
      pickupDate: true,
      returnDate: true,
      order: { select: { id: true, orderNumber: true, status: true } },
    },
    orderBy: { pickupDate: 'asc' },
  })

  return NextResponse.json({
    ok: true,
    bookingItem: {
      id: bookingItem.id,
      // Counted for the BLOCK in front of you, not for the whole item: a
      // hold shared by two date blocks reads "1 of 2 assigned" for the
      // days being filled, not "2 of 3" for the job. Falls back to the
      // item when there are no quoted lines to divide it by.
      quantity: activeBlock?.quantity ?? bookingItem.quantity,
      status: bookingItem.status,
      // Queue position. The picker needs it because a BACKUP is allowed
      // to bind to a unit that is already out — that is the whole point
      // of one — while a primary is not. Without it the drawer disabled
      // every booked candidate, so a 2nd hold could never be pointed at
      // the truck it was queued behind (Jose, 2026-09-16).
      holdRank: bookingItem.holdRank,
      assignedCount: activeBlock ? coverageOfBlock(activeBlock, liveAssignments) : assignedAssetIds.size,
      remaining: Math.max(
        0,
        (activeBlock?.quantity ?? bookingItem.quantity) -
          (activeBlock ? coverageOfBlock(activeBlock, liveAssignments) : assignedAssetIds.size),
      ),
    },
    booking: bookingItem.booking,
    orderId: order?.id ?? null,
    quotedLines: quotedLines.map((l) => ({
      id: l.id,
      description: l.description,
      quantity: l.quantity,
      rate: Number(l.rate),
      rateType: l.rateType,
      billableDays: l.billableDays,
      pickupDate: l.pickupDate,
      returnDate: l.returnDate,
      orderId: l.order.id,
      orderNumber: l.order.orderNumber,
      orderStatus: l.order.status,
    })),
    category: { id: bookingItem.categoryId, ...bookingItem.category },
    // Orders sales may attach a unit to — every live order on this
    // booking's job. Offered as a choice only when there is more than
    // one; with a single candidate the assign route stamps it silently
    // rather than asking a question with one answer.
    candidateOrders: liveOrders,
    // WHICH DAYS these states were computed for, and the date blocks the
    // agent can switch between. An order routinely quotes the same class
    // twice — a van from the 28th and two more from the 29th — and the
    // truck being bound belongs to ONE of those blocks.
    window: {
      start: window.start,
      end: window.end,
      source: window.source,
      orderId: activeOrderId,
    },
    dateBlocks: blocks.map((b) => ({
      start: b.start,
      end: b.end,
      quantity: b.quantity,
      assignedCount: coverageOfBlock(b, liveAssignments),
    })),
    currentAssignments,
    candidates,
    // Units held out of the maths because they are in the shop for these
    // dates. Listed separately so the picker SAYS where the truck went —
    // silently omitting it reads as "we don't own one".
    outOfService: availability.outOfService.map((u) => ({
      assetId: u.assetId,
      unitName: u.unitName,
      tier: u.tier,
      reason: u.reason,
      since: u.since,
      endDate: u.endDate,
    })),
    summary: {
      serviceableCount: availability.serviceableCount,
      freeCount: availability.freeCount,
      bufferCount: availability.bufferCount,
      bookedCount: availability.bookedCount,
      availableToHold: availability.availableToHold,
    },
  })
}
