/**
 * Asset-grain conflict check for a hypothetical date range.
 *
 * Sibling of `getCategoryAvailability` (which works at the category
 * grain — "how many cube trucks are free in this window"). This one
 * answers a different question: "for this specific list of assets,
 * which ones already have an overlapping BookingAssignment somewhere
 * else?" Used by the push-dates preview to surface red flags when a
 * sales rep proposes moving an order's dates onto a span where one of
 * the order's already-assigned units is reserved.
 *
 * Overlap math matches the existing scheduler: a stored assignment
 * `a` collides with the window `[startDate, endDate]` iff
 *
 *   a.startDate <= endDate AND a.endDate >= startDate
 *
 * The `ignoreBookingId` arg skips the order-under-edit's own booking
 * so it doesn't conflict with itself. Pure read — no writes.
 */

import { prisma } from '@/lib/prisma'
import type { AssignmentStatus } from '@prisma/client'

const ACTIVE_STATUSES: AssignmentStatus[] = ['ASSIGNED', 'CHECKED_OUT']

export interface AssetConflict {
  assetId: string
  unitName: string | null
  assignmentId: string
  assignmentStatus: AssignmentStatus
  bookingId: string
  bookingNumber: string
  jobName: string
  bookingStartDate: Date
  bookingEndDate: Date
}

export async function findAssetConflictsForRange(args: {
  assetIds: string[]
  startDate: Date
  endDate: Date
  ignoreBookingId?: string | null
}): Promise<AssetConflict[]> {
  if (args.assetIds.length === 0) return []

  const rows = await prisma.bookingAssignment.findMany({
    where: {
      assetId: { in: args.assetIds },
      status: { in: ACTIVE_STATUSES },
      startDate: { lte: args.endDate },
      endDate: { gte: args.startDate },
      ...(args.ignoreBookingId
        ? { bookingItem: { is: { bookingId: { not: args.ignoreBookingId } } } }
        : {}),
    },
    select: {
      id: true,
      assetId: true,
      status: true,
      asset: { select: { unitName: true } },
      bookingItem: {
        select: {
          booking: {
            select: {
              id: true,
              bookingNumber: true,
              jobName: true,
              startDate: true,
              endDate: true,
            },
          },
        },
      },
    },
    orderBy: { startDate: 'asc' },
  })

  return rows.map((r) => ({
    assetId: r.assetId,
    unitName: r.asset?.unitName ?? null,
    assignmentId: r.id,
    assignmentStatus: r.status,
    bookingId: r.bookingItem.booking.id,
    bookingNumber: r.bookingItem.booking.bookingNumber,
    jobName: r.bookingItem.booking.jobName,
    bookingStartDate: r.bookingItem.booking.startDate,
    bookingEndDate: r.bookingItem.booking.endDate,
  }))
}
