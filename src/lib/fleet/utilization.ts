/**
 * Fleet utilization — "how loaded is a category over a date window?"
 *
 * `getCategoryUtilization` answers: for each day in [startDate, endDate],
 * committed assets ÷ active assets — and returns the PEAK day. It powers the
 * Quick Reply availability tiering (positive vs non-committal verbiage) and
 * the rep-facing utilization strip in EmailReviewModal.
 *
 * "Committed" reuses the native scheduler's exact notion of what holds
 * inventory (src/lib/scheduling/availability.ts — do NOT re-derive):
 *   - BookingAssignment rows with status ASSIGNED or CHECKED_OUT
 *     (ACTIVE_ASSIGNMENT_STATUSES) — unit-bound holds. Counted per distinct
 *     asset per day.
 *   - BookingItem rows with status REQUESTED and holdRank=1 whose parent
 *     Booking window covers the day — pending category demand not yet bound
 *     to a unit. Backups (holdRank ≥ 2) don't consume capacity, matching the
 *     scheduler. Counted by quantity.
 * Booking.status itself is not consulted — the scheduler doesn't either.
 *
 * "Active" (the denominator) is the scheduler's serviceable pool: Asset rows
 * with isActive=true and status not in SERVICEABLE_EXCLUDED_STATUSES
 * (MAINTENANCE / RETIRED / SOLD / STOLEN).
 *
 * Date semantics match the scheduler: @db.Date columns arrive as UTC-midnight
 * Dates, both endpoints inclusive.
 */

import { prisma } from '@/lib/prisma'
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  SERVICEABLE_EXCLUDED_STATUSES,
} from '@/lib/scheduling/availability'

const ONE_DAY_MS = 86_400_000
// Safety valve on the per-day loop — inquiry dates come from parsed emails
// and can be garbage. A year+ window is not a real rental inquiry.
const MAX_WINDOW_DAYS = 370

export interface CategoryUtilization {
  categoryId: string
  /** Serviceable (in-service) asset count — the denominator. */
  activeAssets: number
  /** Committed count on the busiest day of the window. */
  peakCommitted: number
  /** UTC-midnight date of the busiest day; null when activeAssets is 0. */
  peakDate: Date | null
  /** peakCommitted / activeAssets. Can exceed 1 when overbooked.
   *  null when activeAssets is 0 (no meaningful ratio). */
  utilization: number | null
}

/**
 * Peak-day utilization for one category over an inclusive date window.
 * Both dates must be UTC-midnight Dates (same convention as the scheduler).
 */
export async function getCategoryUtilization(
  assetCategoryId: string,
  startDate: Date,
  endDate: Date,
): Promise<CategoryUtilization> {
  const windowStart = startDate
  const windowEnd = endDate < startDate ? startDate : endDate

  const assets = await prisma.asset.findMany({
    where: {
      categoryId: assetCategoryId,
      isActive: true,
      status: { notIn: [...SERVICEABLE_EXCLUDED_STATUSES] },
    },
    select: { id: true },
  })

  if (assets.length === 0) {
    return { categoryId: assetCategoryId, activeAssets: 0, peakCommitted: 0, peakDate: null, utilization: null }
  }

  const [assignments, requestedItems] = await Promise.all([
    prisma.bookingAssignment.findMany({
      where: {
        assetId: { in: assets.map((a) => a.id) },
        status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
        startDate: { lte: windowEnd },
        endDate: { gte: windowStart },
      },
      select: { assetId: true, startDate: true, endDate: true },
    }),
    prisma.bookingItem.findMany({
      where: {
        categoryId: assetCategoryId,
        status: 'REQUESTED',
        holdRank: 1,
        booking: { startDate: { lte: windowEnd }, endDate: { gte: windowStart } },
      },
      select: { quantity: true, booking: { select: { startDate: true, endDate: true } } },
    }),
  ])

  const dayCount = Math.min(
    MAX_WINDOW_DAYS,
    Math.round((windowEnd.getTime() - windowStart.getTime()) / ONE_DAY_MS) + 1,
  )

  let peakCommitted = 0
  let peakDate: Date | null = windowStart
  for (let i = 0; i < dayCount; i++) {
    const day = new Date(windowStart.getTime() + i * ONE_DAY_MS)
    // Distinct assets — an asset with two touching assignments on the same
    // day is still one committed unit.
    const boundAssets = new Set<string>()
    for (const a of assignments) {
      if (a.startDate <= day && a.endDate >= day) boundAssets.add(a.assetId)
    }
    let committed = boundAssets.size
    for (const item of requestedItems) {
      if (item.booking.startDate <= day && item.booking.endDate >= day) {
        committed += item.quantity
      }
    }
    if (committed > peakCommitted) {
      peakCommitted = committed
      peakDate = day
    }
  }

  return {
    categoryId: assetCategoryId,
    activeAssets: assets.length,
    peakCommitted,
    peakDate,
    utilization: peakCommitted / assets.length,
  }
}
