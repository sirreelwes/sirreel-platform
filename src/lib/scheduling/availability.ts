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
import { naSummary } from '@/lib/scheduling/naTitles'

// Exported so downstream consumers (e.g. src/lib/fleet/utilization.ts) reuse
// the scheduler's exact notion of "out of service" / "holds inventory"
// instead of re-deriving their own status sets.
export const SERVICEABLE_EXCLUDED_STATUSES = ['MAINTENANCE', 'RETIRED', 'SOLD', 'STOLEN', 'TOTALED'] as const
export const ACTIVE_ASSIGNMENT_STATUSES = ['ASSIGNED', 'CHECKED_OUT'] as const

/**
 * A unit is ALSO out of service while it carries an OPEN MaintenanceRecord
 * overlapping the window — and that is the state the fleet and sales UI
 * actually write.
 *
 * `POST /api/scheduling/assets/[assetId]/maintenance` ("refer to
 * maintenance" from sales, "mark N/A" from fleet) deliberately reuses
 * MaintenanceRecord instead of touching `Asset.status`: "reuses the existing
 * model + the shipped N/A grey display; no schema change". The Gantt honours
 * it, but this engine read `Asset.status` alone — so a truck greyed on the
 * board still offered an Assign button in the unit picker, still counted in
 * `serviceableCount`, and still fed the Quick Reply "we have N free" line.
 * Wes 2026-09-10: "many units show available that i have marked unavailable
 * or referred to maintenance" — Cube 8, 9 (out of service, fleet) and Cube
 * 12, 17, 24 (sales referral) all read `available` in the SuperCube picker.
 *
 * Both open statuses count. A referral is precautionary and a fleet mark is
 * confirmed, but neither is a truck we hand to a client, and the referral is
 * the one sales raises BEFORE anyone has looked at it.
 */
export const OPEN_MAINTENANCE_STATUSES = ['SCHEDULED', 'IN_PROGRESS'] as const

/** A unit held out of the fleet for the window, and why. */
export interface OutOfServiceUnit {
  assetId: string
  unitName: string
  tier: AssetTier
  /** One line for a human — the symptom if one was typed, else the title. */
  reason: string
  /** When it went out. Open-ended records have no end. */
  since: Date
  endDate: Date | null
}

/**
 * Which of `assetIds` are out of service for [windowStart, windowEnd], with
 * the reason. Overlap is inclusive on both ends, and an OPEN-ENDED record
 * (endDate null — every record the N/A route writes) covers everything from
 * its start onward.
 */
export async function outOfServiceByAsset(
  assetIds: string[],
  windowStart: Date,
  windowEnd: Date,
): Promise<Map<string, { reason: string; since: Date; endDate: Date | null }>> {
  const out = new Map<string, { reason: string; since: Date; endDate: Date | null }>()
  if (assetIds.length === 0) return out
  const records = await prisma.maintenanceRecord.findMany({
    where: {
      assetId: { in: assetIds },
      status: { in: [...OPEN_MAINTENANCE_STATUSES] },
      startDate: { lte: windowEnd },
      OR: [{ endDate: null }, { endDate: { gte: windowStart } }],
    },
    select: { assetId: true, title: true, description: true, startDate: true, endDate: true },
    orderBy: { startDate: 'asc' },
  })
  for (const r of records) {
    // First (earliest) record wins the row — a unit with two open tickets is
    // out for the older reason, which is the one that has been waiting.
    if (out.has(r.assetId)) continue
    out.set(r.assetId, {
      reason: naSummary(r.title, r.description) ?? r.title,
      since: r.startDate,
      endDate: r.endDate,
    })
  }
  return out
}

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
  /** Units dropped from the maths because they are in the shop for this
   *  window. Returned rather than silently omitted so a picker can say
   *  where the truck went instead of just not listing it. */
  outOfService: OutOfServiceUnit[]
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
  // Display fields come off the merged catalog row. totalUnits on the
  // frozen AssetCategory was never mirrored, so it goes stale the moment
  // qtyOwned is edited. The serviceable count below still comes from the
  // Asset rows themselves, which both rows share.
  const merged = await prisma.inventoryItem.findUnique({
    where: { legacyAssetCategoryId: categoryId },
    select: { description: true, code: true, slug: true, qtyOwned: true },
  })
  const category = merged
    ? {
        id: categoryId,
        name: merged.description || merged.code,
        slug: merged.slug ?? '',
        totalUnits: merged.qtyOwned,
      }
    : await prisma.assetCategory.findUnique({
        where: { id: categoryId },
        select: { id: true, name: true, slug: true, totalUnits: true },
      })

  const allAssets = await prisma.asset.findMany({
    where: {
      categoryId,
      isActive: true,
      status: { notIn: [...SERVICEABLE_EXCLUDED_STATUSES] },
    },
    select: { id: true, unitName: true, tier: true },
    orderBy: { unitName: 'asc' },
  })

  // Second gate: an OPEN maintenance record for THIS window. `Asset.status`
  // alone is not the fleet's answer — see OPEN_MAINTENANCE_STATUSES above.
  // Dropping these here rather than at each call site means every consumer
  // (unit picker, hold capacity, rank/promote, Quick Reply's "N free")
  // stops counting a truck that is in the shop.
  const oos = await outOfServiceByAsset(
    allAssets.map((a) => a.id),
    startDate,
    endDate,
  )
  const assets = allAssets.filter((a) => !oos.has(a.id))
  const outOfService: OutOfServiceUnit[] = allAssets
    .filter((a) => oos.has(a.id))
    .map((a) => ({
      assetId: a.id,
      unitName: a.unitName,
      tier: a.tier,
      reason: oos.get(a.id)!.reason,
      since: oos.get(a.id)!.since,
      endDate: oos.get(a.id)!.endDate,
    }))

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
  // Count only the UNCOVERED remainder of each hold, not its full
  // quantity. A partially-assigned item stays REQUESTED (partial
  // coverage keeps it on the stale-holds radar), but its bound units
  // already show up in bookedCount above — subtracting the full
  // quantity as well double-counts the covered portion, understating
  // availableToHold. Repro that motivated this: 3-unit category, one
  // qty-2 hold with 1 unit bound → free=2 yet availableToHold=0; the
  // truth is 1 (one bound unit + one unit of remaining demand).
  const requestedItems = await prisma.bookingItem.findMany({
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
    select: {
      quantity: true,
      _count: {
        select: {
          assignments: { where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } } },
        },
      },
    },
  })
  const requestedQty = requestedItems.reduce(
    (sum, item) => sum + Math.max(0, item.quantity - item._count.assignments),
    0,
  )

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
    outOfService,
  }
}
