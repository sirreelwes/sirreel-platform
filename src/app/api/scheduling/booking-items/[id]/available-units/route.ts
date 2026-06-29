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

export const dynamic = 'force-dynamic'

const TIER_ORDER: Record<AssetTier, number> = {
  PREMIUM: 0,
  STANDARD: 1,
  ECONOMY: 2,
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const bookingItem = await prisma.bookingItem.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      categoryId: true,
      quantity: true,
      status: true,
      booking: {
        select: { id: true, bookingNumber: true, jobName: true, startDate: true, endDate: true },
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
