/**
 * GET /api/scheduling/booking-items/[id]/available-units
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

  // Exclude THIS booking item's own assignments + pending demand so the
  // unit it's already on isn't counted as a conflict against itself and the
  // pooled summary reflects true remaining capacity for the edit.
  const availability = await getCategoryAvailability(
    bookingItem.categoryId,
    bookingItem.booking.startDate,
    bookingItem.booking.endDate,
    bufferDays,
    bookingItem.id,
  )

  const assignedAssetIds = new Set(bookingItem.assignments.map((a) => a.assetId))

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
      quantity: bookingItem.quantity,
      status: bookingItem.status,
      assignedCount: bookingItem.assignments.length,
      remaining: Math.max(0, bookingItem.quantity - bookingItem.assignments.length),
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
    currentAssignments,
    candidates,
    summary: {
      serviceableCount: availability.serviceableCount,
      freeCount: availability.freeCount,
      bufferCount: availability.bufferCount,
      bookedCount: availability.bookedCount,
      availableToHold: availability.availableToHold,
    },
  })
}
