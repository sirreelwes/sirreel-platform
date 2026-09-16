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
  /**
   * WHO asked, for the audit row this function writes.
   *
   * Releasing a hold used to leave no trace anywhere: on 2026-09-15 all
   * three lines on SR-JOB-0391 read UNFULFILLED with a van still going
   * out the next morning, and the question "who released this — did the
   * client do it?" was unanswerable from the data. Every release surface
   * goes through this function, so the record belongs here rather than
   * in five routes that would each forget it.
   *
   * Optional so no caller breaks, but pass it: an audit row with a null
   * actor and no source is only marginally better than none.
   */
  actor?: ReleaseActor
}

export interface ReleaseActor {
  /** The user who clicked. Null for cron/system paths, which name
   *  themselves in `source` instead. */
  userId?: string | null
  /** The surface that asked — 'release-route', 'job-holds',
   *  'switch-class', 'planyo-auto-release'. Reads in the audit trail as
   *  the answer to "where was this done from". */
  source: string
  /** Free text the surface already had (a mark-lost reason, the class a
   *  line switched to). */
  reason?: string | null
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

/**
 * The trail. NON-FATAL and after the fact, the same contract the rank
 * route's audit follows — a logging outage must never be the reason a
 * truck stays held.
 *
 * Written from here rather than from the routes so every surface is
 * covered by construction: the release endpoint, the job's Release-holds
 * list, switch-class and the Planyo auto-release cron all land the same
 * row shape, and a surface added later inherits it without remembering to.
 */
async function recordRelease(args: {
  item: {
    id: string
    status: string
    quantity: number
    category: { name: string } | null
    booking: { bookingNumber: string | null; jobName: string | null; jobId: string | null } | null
    assignments: { assetId: string; asset: { unitName: string } | null }[]
  }
  actor: ReleaseActor | undefined
  outcome: { mode: 'ITEM' | 'UNITS'; status: string; quantity: number; swappedAssignmentCount: number; alreadyReleased: boolean }
  releasedAssetIds: string[]
}): Promise<void> {
  const { item, actor, outcome } = args
  const nameOf = new Map(item.assignments.map((a) => [a.assetId, a.asset?.unitName ?? a.assetId]))
  try {
    await prisma.auditLog.create({
      data: {
        userId: actor?.userId ?? null,
        action: 'booking_item.released',
        entityType: 'BookingItem',
        entityId: item.id,
        oldValues: { status: item.status, quantity: item.quantity },
        newValues: {
          status: outcome.status,
          quantity: outcome.quantity,
          mode: outcome.mode,
          // Named units in WORDS. "Cargo 35 handed back" is the line a
          // human is looking for; the id is no use at 6am in the yard.
          units: args.releasedAssetIds.map((id) => nameOf.get(id) ?? id),
          swappedAssignmentCount: outcome.swappedAssignmentCount,
          // TRUE means the line was already dead and this call only swept
          // stranded assignments — not a second release of live capacity.
          alreadyReleased: outcome.alreadyReleased,
          category: item.category?.name ?? null,
          bookingNumber: item.booking?.bookingNumber ?? null,
          jobName: item.booking?.jobName ?? null,
          jobId: item.booking?.jobId ?? null,
          source: actor?.source ?? 'unattributed',
          reason: actor?.reason ?? null,
        },
      },
    })
  } catch (err) {
    console.error('[releaseBookingItem] audit failed:', err instanceof Error ? err.message : err)
  }
}

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
      // Read for the audit row as much as for the release: a trail that
      // says only "BookingItem eae833f7" makes whoever reads it go
      // looking for the job anyway.
      category: { select: { name: true } },
      booking: { select: { bookingNumber: true, jobName: true, jobId: true } },
      assignments: {
        where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
        select: { id: true, assetId: true, asset: { select: { unitName: true } } },
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
    const outcome = {
      ok: true as const,
      alreadyReleased: false,
      bookingItemId: item.id,
      swappedAssignmentCount: swapped,
      mode: 'UNITS' as const,
      quantity: plan.newQuantity,
      status: plan.newStatus,
      unmatchedAssetIds: plan.unmatchedAssetIds,
    }
    await recordRelease({ item, actor: options.actor, outcome, releasedAssetIds: plan.releaseAssetIds })
    return outcome
  }

  // ── Whole line ───────────────────────────────────────────────────────
  if (item.status === 'UNFULFILLED') {
    const healed = await prisma.bookingAssignment.updateMany({
      where: { bookingItemId: item.id, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
      data: { status: 'SWAPPED' },
    })
    const outcome = {
      ok: true as const,
      alreadyReleased: true,
      bookingItemId: item.id,
      swappedAssignmentCount: healed.count,
      mode: 'ITEM' as const,
      quantity: item.quantity,
      status: 'UNFULFILLED' as const,
      unmatchedAssetIds: plan?.unmatchedAssetIds ?? [],
    }
    // Only when something actually moved. A no-op re-release of a line
    // that is already dead and already swept is noise, and the trail is
    // only worth reading if every row in it is an event.
    if (healed.count > 0) {
      await recordRelease({
        item,
        actor: options.actor,
        outcome,
        releasedAssetIds: item.assignments.map((a) => a.assetId),
      })
    }
    return outcome
  }

  const outcome = await prisma.$transaction(async (tx) => {
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
  await recordRelease({
    item,
    actor: options.actor,
    outcome,
    releasedAssetIds: item.assignments.map((a) => a.assetId),
  })
  return outcome
}
