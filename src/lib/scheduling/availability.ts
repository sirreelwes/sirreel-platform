/**
 * Native-scheduling availability engine (Chunk 2 of
 * native-scheduling-v1-brief.md).
 *
 * The function this module exists for, `getCategoryAvailability`,
 * answers "given a window [startDate, endDate] and a category, what
 * units are free / on-buffer / hard-booked, and is there capacity for
 * another hold?" — without consulting Planyo.
 *
 * Two layers:
 *
 *   - `computeUnitStates` is the pure conflict arithmetic. Given a set
 *     of serviceable assets and their active assignments, it returns
 *     per-unit state. NO I/O — fully unit-testable. This is the
 *     function that, wrong, double-books a stage. It has boundary
 *     tests in `tests/scheduling/availability.test.ts`.
 *
 *   - `getCategoryAvailability` is the DB orchestrator. Pulls
 *     serviceable assets, pulls overlapping assignments, calls
 *     `computeUnitStates`, then computes capacity by also pulling
 *     unassigned REQUESTED holds that overlap the parent Booking
 *     window. Convenient signature; no prisma in the param list, in
 *     line with the rest of `src/lib/*`.
 *
 * Date semantics: `Booking.startDate`, `Booking.endDate`,
 * `BookingAssignment.startDate`, `BookingAssignment.endDate` are all
 * `@db.Date` columns. Prisma returns them as `Date` objects at UTC
 * midnight. Both endpoints are inclusive — a one-day rental has
 * startDate === endDate.
 *
 * Per the brief:
 *   - hard overlap (state='booked')  iff  a.start <= w.end AND a.end >= w.start
 *   - buffer (state='buffer')        iff  no hard overlap AND
 *                                          clearDays(adjacent) < bufferDays
 *                                          (either side of the window)
 *   - free                            otherwise
 *
 * `clearDays(earlier.end, later.start)` = the count of fully unbooked
 * calendar days strictly between two assignments. Example with
 * bufferDays=1: assignment ending 5/10 and new window starting 5/11
 * has clearDays=0 (no buffer day in between) → buffer. New window
 * starting 5/12 has clearDays=1 (5/11 is clear) → free.
 */

import { prisma } from '@/lib/prisma'
import type { AssetTier } from '@prisma/client'

const SERVICEABLE_EXCLUDED_STATUSES = ['MAINTENANCE', 'RETIRED', 'SOLD', 'STOLEN'] as const
const ACTIVE_ASSIGNMENT_STATUSES = ['ASSIGNED', 'CHECKED_OUT'] as const

export type UnitState = 'free' | 'buffer' | 'booked'

export interface ServiceableAsset {
  id: string
  unitName: string
  tier: AssetTier
}

export interface AssignmentWindow {
  assetId: string
  startDate: Date // inclusive, UTC-midnight Date
  endDate: Date // inclusive, UTC-midnight Date
}

export interface AvailabilityUnit {
  assetId: string
  unitName: string
  tier: AssetTier
  state: UnitState
}

export interface CategoryAvailability {
  category: { id: string; name: string; slug: string; totalUnits: number } | null
  totalUnits: number
  serviceableCount: number
  freeCount: number
  bufferCount: number
  bookedCount: number
  availableToHold: number
  units: AvailabilityUnit[]
}

/**
 * Count of fully-clear calendar days strictly between two inclusive
 * windows. Negative when windows overlap; zero when consecutive
 * (return day immediately followed by next pickup day, the same-day
 * turnaround case).
 */
export function clearDaysBetween(earlierEnd: Date, laterStart: Date): number {
  const ms = laterStart.getTime() - earlierEnd.getTime()
  const oneDayMs = 86_400_000
  return Math.round(ms / oneDayMs) - 1
}

/**
 * PURE — given a set of serviceable assets and active assignments on
 * them, classify each asset's state for the given window.
 */
export function computeUnitStates(
  serviceableAssets: ServiceableAsset[],
  assignments: AssignmentWindow[],
  windowStart: Date,
  windowEnd: Date,
  bufferDays: number,
): AvailabilityUnit[] {
  const byAsset = new Map<string, AssignmentWindow[]>()
  for (const a of assignments) {
    const list = byAsset.get(a.assetId) ?? []
    list.push(a)
    byAsset.set(a.assetId, list)
  }

  return serviceableAssets.map((asset) => {
    const my = byAsset.get(asset.id) ?? []

    const hard = my.some((a) => a.startDate <= windowEnd && a.endDate >= windowStart)
    if (hard) {
      return { assetId: asset.id, unitName: asset.unitName, tier: asset.tier, state: 'booked' as const }
    }

    const buffer = my.some((a) => {
      // assignment ends before the window starts
      if (a.endDate < windowStart) {
        return clearDaysBetween(a.endDate, windowStart) < bufferDays
      }
      // assignment starts after the window ends
      if (a.startDate > windowEnd) {
        return clearDaysBetween(windowEnd, a.startDate) < bufferDays
      }
      // any other relationship is a hard overlap and was caught above
      return false
    })

    return {
      assetId: asset.id,
      unitName: asset.unitName,
      tier: asset.tier,
      state: buffer ? ('buffer' as const) : ('free' as const),
    }
  })
}

/**
 * DB-backed: serviceable units + their active assignments + capacity
 * accounting. Returns the per-unit state map plus a categorical
 * `availableToHold` count.
 */
export async function getCategoryAvailability(
  categoryId: string,
  startDate: Date,
  endDate: Date,
  bufferDays: number = 1,
  // EXCLUDE-SELF: when recomputing availability for an EXISTING hold being
  // edited (the unit-pick drawer reopened from a hold detail view), pass that
  // BookingItem's id so its OWN assignments + pending REQUESTED qty don't count
  // against it — otherwise the unit it's already on shows as self-conflicting
  // and the pooled count is understated by its own demand.
  excludeBookingItemId?: string | null,
): Promise<CategoryAvailability> {
  const category = await prisma.assetCategory.findUnique({
    where: { id: categoryId },
    select: { id: true, name: true, slug: true, totalUnits: true },
  })

  const assets = await prisma.asset.findMany({
    where: {
      categoryId,
      isActive: true,
      status: { notIn: [...SERVICEABLE_EXCLUDED_STATUSES] },
    },
    select: { id: true, unitName: true, tier: true },
    orderBy: { unitName: 'asc' },
  })

  // Pull a buffered query window so we catch adjacent assignments that
  // would trip the buffer rule. lookaround = bufferDays + 1 is enough
  // for the comparison; widening more is harmless but wasteful.
  const lookaround = Math.max(1, bufferDays + 1)
  const queryStart = new Date(startDate.getTime() - lookaround * 86_400_000)
  const queryEnd = new Date(endDate.getTime() + lookaround * 86_400_000)

  const assignments = assets.length
    ? await prisma.bookingAssignment.findMany({
        where: {
          assetId: { in: assets.map((a) => a.id) },
          status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
          startDate: { lte: queryEnd },
          endDate: { gte: queryStart },
          // Exclude this hold's own assignments when editing it.
          ...(excludeBookingItemId ? { bookingItemId: { not: excludeBookingItemId } } : {}),
        },
        select: { assetId: true, startDate: true, endDate: true },
      })
    : []

  const units = computeUnitStates(assets, assignments, startDate, endDate, bufferDays)

  const bookedCount = units.filter((u) => u.state === 'booked').length
  const bufferCount = units.filter((u) => u.state === 'buffer').length
  const freeCount = units.filter((u) => u.state === 'free').length

  // REQUESTED holds against this category whose parent Booking's
  // rental window overlaps the requested window. These represent
  // *pending* category demand that hasn't been bound to a unit yet,
  // so subtract from capacity even though no asset is locked.
  //
  // Only rank-1 (primary) holds consume capacity. Backups (rank ≥ 2)
  // are explicitly allowed to overlap an at-capacity category — they
  // queue behind the primary and only become real when an agent
  // promotes them. This keeps the conflict math identical to before
  // backups existed; ranking is a queue layer on top, not a change
  // to the availability calculation.
  const requestedAgg = await prisma.bookingItem.aggregate({
    where: {
      categoryId,
      status: 'REQUESTED',
      holdRank: 1,
      // Exclude this hold's own pending demand when editing it.
      ...(excludeBookingItemId ? { id: { not: excludeBookingItemId } } : {}),
      booking: {
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    },
    _sum: { quantity: true },
  })
  const requestedQty = requestedAgg._sum.quantity ?? 0

  const availableToHold = assets.length - bookedCount - requestedQty

  return {
    category,
    totalUnits: category?.totalUnits ?? 0,
    serviceableCount: assets.length,
    freeCount,
    bufferCount,
    bookedCount,
    availableToHold,
    units,
  }
}
