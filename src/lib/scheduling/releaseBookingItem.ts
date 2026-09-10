/**
 * The one place a hold is released.
 *
 * Extracted from POST /api/scheduling/booking-items/[id]/release so the
 * endpoint and the Planyo auto-release cron share a single
 * implementation — two copies of "release a hold" would drift, and the
 * drift would show up as trucks stuck on the board.
 *
 * WHOLE-ITEM semantics (no `assetIds` passed — unchanged):
 *   · item → UNFULFILLED
 *   · every ACTIVE assignment on that item → SWAPPED, regardless of the
 *     item's prior status. A partially-assigned item sits at REQUESTED
 *     while holding assignments; gating on ASSIGNED stranded the unit.
 *   · already UNFULFILLED → idempotent, but still sweeps active
 *     assignments so rows stranded by the old behaviour can be healed.
 *   · SUBSTITUTED → refused; a terminal state this doesn't manage.
 *
 * PER-UNIT semantics (`assetIds` passed — Wes 2026-09-10: "when you
 * release one held asset on a job, it releases all sometimes. It needs
 * to be release by asset specific"):
 *   A BookingItem is a CATEGORY LINE with a quantity, so one row can
 *   hold two motorhomes. Every release surface aimed at a single truck —
 *   a Gantt bar, a ticked unit on the job's Release-holds list — was
 *   still calling the whole-item release, which swapped the SIBLING
 *   trucks' assignments too. The other production's unit vanished off
 *   the board with no trace beyond a SWAPPED row.
 *
 *   So a named release now hands back exactly what was named:
 *     · the named assets' active assignments → SWAPPED
 *     · quantity DROPS by the number handed back, or the line would
 *       keep holding a pooled slot for a unit nobody wants (availability
 *       counts `quantity - assignedCount` as live demand)
 *     · status re-derives: still fully covered → ASSIGNED, otherwise
 *       REQUESTED, so a part-covered line re-enters the assign lane
 *     · when nothing would be left (quantity hits 0), it degrades to the
 *       whole-item release above — one truck on a one-truck line is the
 *       same act either way.
 *
 * NOT the same thing as `unassign`, which DELETES the pick and leaves
 * the quantity alone (the job still wants a unit, just not that one).
 * Release means the job stops holding the capacity.
 *
 * NOT the same thing as reconcileHolds.applyRelease, which DELETES the
 * BookingItem and needs the row present in the Planyo pull. This is the
 * non-destructive form: the rows stay, auditable.
 */

import { prisma } from '@/lib/prisma'
import { planUnitRelease } from '@/lib/scheduling/holdRelease'

// Re-exported so callers that already reach for the release recipe get
// the addressing helpers from the same place.
export { holdRowId, parseHoldRowId, planUnitRelease } from '@/lib/scheduling/holdRelease'
export type { ParsedHoldRowId, ReleasePlan } from '@/lib/scheduling/holdRelease'

const ACTIVE_ASSIGNMENT_STATUSES = ['ASSIGNED', 'CHECKED_OUT'] as const

export interface ReleaseOptions {
  /**
   * Release only these assets' holds off the line. Omit for the
   * whole-item release. Ids not actually assigned to the item are
   * ignored (reported back as `unmatchedAssetIds`) rather than widening
   * the release — a stale browser must never take down a truck it can
   * no longer see.
   */
  assetIds?: string[]
  /**
   * Also drop this many UNASSIGNED slots off the line (the "2 more, no
   * unit picked" remainder row on the job's release list). Defaults to 0.
   */
  pooledSlots?: number
}

export type ReleaseOutcome =
  | {
      ok: true
      alreadyReleased: boolean
      bookingItemId: string
      swappedAssignmentCount: number
      /** ITEM = the whole line came down. UNITS = named units only. */
      mode: 'ITEM' | 'UNITS'
      /** Quantity the line carries after the release. */
      quantity: number
      status: 'REQUESTED' | 'ASSIGNED' | 'UNFULFILLED'
      /** Asked-for assets that weren't actively assigned to this item. */
      unmatchedAssetIds: string[]
    }
  | { ok: false; reason: string; code: 'NOT_FOUND' | 'TERMINAL' }

export async function releaseBookingItem(
  bookingItemId: string,
  options: ReleaseOptions = {},
): Promise<ReleaseOutcome> {
  const item = await prisma.bookingItem.findUnique({
    where: { id: bookingItemId },
    select: {
      id: true,
      status: true,
      quantity: true,
      assignments: {
        where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
        select: { id: true, assetId: true },
      },
    },
  })
  if (!item) return { ok: false, reason: 'booking item not found', code: 'NOT_FOUND' }

  if (item.status === 'SUBSTITUTED') {
    return {
      ok: false,
      code: 'TERMINAL',
      reason: `BookingItem is in terminal status=${item.status}; release does not manage SUBSTITUTED rows. Restore the item before releasing if that's the intent.`,
    }
  }

  const named = options.assetIds ?? null
  const plan = named
    ? planUnitRelease({
        quantity: item.quantity,
        assignedAssetIds: item.assignments.map((a) => a.assetId),
        releaseAssetIds: named,
        pooledSlots: options.pooledSlots,
      })
    : null

  // ── Named units, and something survives on the line ──────────────────
  if (plan && plan.mode === 'UNITS') {
    // Nothing matched and no pooled slot asked for: the browser named
    // units this line no longer holds. Report it rather than silently
    // rewriting the quantity.
    if (plan.releaseAssetIds.length === 0 && (options.pooledSlots ?? 0) === 0) {
      return {
        ok: true,
        alreadyReleased: true,
        bookingItemId: item.id,
        swappedAssignmentCount: 0,
        mode: 'UNITS',
        quantity: item.quantity,
        status: item.status as 'REQUESTED' | 'ASSIGNED',
        unmatchedAssetIds: plan.unmatchedAssetIds,
      }
    }
    const swapped = await prisma.$transaction(async (tx) => {
      const res = await tx.bookingAssignment.updateMany({
        where: {
          bookingItemId: item.id,
          assetId: { in: plan.releaseAssetIds },
          status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
        },
        data: { status: 'SWAPPED' },
      })
      await tx.bookingItem.update({
        where: { id: item.id },
        data: { quantity: plan.newQuantity, status: plan.newStatus },
      })
      return res.count
    })
    return {
      ok: true,
      alreadyReleased: false,
      bookingItemId: item.id,
      swappedAssignmentCount: swapped,
      mode: 'UNITS',
      quantity: plan.newQuantity,
      status: plan.newStatus,
      unmatchedAssetIds: plan.unmatchedAssetIds,
    }
  }

  // ── Whole line ───────────────────────────────────────────────────────
  if (item.status === 'UNFULFILLED') {
    const healed = await prisma.bookingAssignment.updateMany({
      where: { bookingItemId: item.id, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
      data: { status: 'SWAPPED' },
    })
    return {
      ok: true,
      alreadyReleased: true,
      bookingItemId: item.id,
      swappedAssignmentCount: healed.count,
      mode: 'ITEM',
      quantity: item.quantity,
      status: 'UNFULFILLED',
      unmatchedAssetIds: plan?.unmatchedAssetIds ?? [],
    }
  }

  return prisma.$transaction(async (tx) => {
    const swapped = await tx.bookingAssignment.updateMany({
      where: { bookingItemId: item.id, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
      data: { status: 'SWAPPED' },
    })
    await tx.bookingItem.update({ where: { id: item.id }, data: { status: 'UNFULFILLED' } })
    return {
      ok: true as const,
      alreadyReleased: false,
      bookingItemId: item.id,
      swappedAssignmentCount: swapped.count,
      mode: 'ITEM' as const,
      quantity: item.quantity,
      status: 'UNFULFILLED' as const,
      unmatchedAssetIds: plan?.unmatchedAssetIds ?? [],
    }
  })
}
