/**
 * Bind ONE specific Asset to a BookingItem — the one recipe.
 *
 * This is the body of POST /api/scheduling/booking-items/[id]/assign,
 * lifted into a library because a second caller arrived (Wes
 * 2026-09-10): adding a vehicle to an order now holds the class AND
 * binds the next available unit in the same request, so the order
 * page needs the same conflict checks the picker modal gets — the
 * rank-aware overlap guard, the buffer warning, the out-of-service
 * refusal — without a second copy of them drifting.
 *
 * Every refusal comes back as `{ ok: false, status, body }` in the
 * exact shape the route used to send, so the route stays a thin
 * wrapper and existing callers (the gantt drag, AssignUnitsModal, the
 * Make Reservation flow) see nothing change.
 */
import { prisma } from '@/lib/prisma'
import {
  computeUnitStates,
  outOfServiceByAsset,
  type AssignmentWindow,
  type ServiceableAsset,
} from '@/lib/scheduling/availability'
import { deriveOrderWindow } from '@/lib/jobs/dateRange'
import { quotedBlocks, resolveAssignWindow, type ResolvedWindow } from '@/lib/scheduling/assignWindow'
import { quotedLinesForHold } from '@/lib/scheduling/quotedLines'
import { formatCalendarDate, formatCalendarRange } from '@/lib/dates/calendarDate'

/** Two date ranges touching at all. Inclusive both ends: a return on the
 *  22nd and a pickup on the 22nd are the same day on this board. */
function overlaps(a: { startDate: Date; endDate: Date }, start: Date, end: Date): boolean {
  return a.startDate <= end && a.endDate >= start
}

export interface AssignUnitArgs {
  bookingItemId: string
  assetId: string
  bufferDays?: number
  bufferOverride?: boolean
  /** Which order this unit goes out on. With exactly one live order on
   *  the job it is stamped without asking. */
  orderId?: string | null
  /** The DATE BLOCK this unit is filling — the days the picker checked,
   *  or the line that was just added. Honoured when it falls inside what
   *  the order and the hold cover; otherwise the block is resolved from
   *  the quoted lines. See assignWindow.ts. */
  windowStart?: Date | string | null
  windowEnd?: Date | string | null
  /**
   * SWAP: the unit this one replaces on the SAME date block. A full block
   * has no open slot, so changing which truck goes out used to mean
   * Remove-then-Assign — two requests with the block sitting uncovered in
   * between, and the picker hid the candidate list the moment the block
   * was full, leaving the agent looking at nothing but out-of-service
   * trucks (Wes 2026-09-14). Naming the outgoing unit here frees its slot
   * for the capacity check and drops it in the SAME transaction that
   * binds the replacement.
   */
  replaceAssetId?: string | null
  /**
   * WHICH LINE of that order this truck is — the through line from a
   * quoted vehicle line to its unit (Wes 2026-09-16). Set by the line
   * add, the class switch and the picker opened from a line; a swap
   * inherits the outgoing unit's line the way it inherits its order.
   * Verified against the order so a stray id cannot pin a truck to
   * somebody else's line. See lib/orders/lineUnits.ts.
   */
  orderLineItemId?: string | null
  /**
   * Who is picking, for the audit row a REVIVED line writes. Same shape
   * as a release's actor (lib/scheduling/releaseBookingItem) so the two
   * halves of a hold's life read alike in the trail.
   */
  actor?: { userId?: string | null; source: string }
}

export interface AssignedUnit {
  id: string
  status: string
  startDate: Date
  endDate: Date
  orderLineItemId: string | null
  asset: { id: string; unitName: string; tier: string }
}

export type AssignUnitResult =
  | {
      ok: true
      assignment: AssignedUnit
      bookingItem: { id: string; quantity: number; status: string; assignedCount: number; remaining: number }
      bufferOverrideUsed: boolean
      /** The days the unit was actually bound for, and why those days. */
      window: { start: string; end: string; source: ResolvedWindow['source'] }
      /** The unit this one replaced, when the caller asked for a swap. */
      replacedAssetId: string | null
    }
  | { ok: false; status: number; body: Record<string, unknown> }

export async function assignUnitToBookingItem(args: AssignUnitArgs): Promise<AssignUnitResult> {
  const bufferDays = Number.isFinite(args.bufferDays) ? (args.bufferDays as number) : 1
  const refuse = (status: number, body: Record<string, unknown>): AssignUnitResult => ({ ok: false, status, body })

  const bookingItem = await prisma.bookingItem.findUnique({
    where: { id: args.bookingItemId },
    select: {
      id: true,
      categoryId: true,
      quantity: true,
      status: true,
      holdRank: true,
      booking: { select: { id: true, jobId: true, startDate: true, endDate: true } },
      // Live ones only, with their dates: a released or swapped assignment
      // occupies nothing, and one for another date block is not in the way.
      assignments: {
        where: { status: { in: ['ASSIGNED', 'CHECKED_OUT'] } },
        select: { id: true, assetId: true, startDate: true, endDate: true, status: true, orderId: true, orderLineItemId: true },
      },
    },
  })
  if (!bookingItem) return refuse(404, { error: 'booking item not found' })

  // SUBSTITUTED is the one state a pick must not touch. The line was
  // replaced by another line, so binding a truck here would hold the
  // same demand twice — once on the substitute, once on a row nothing
  // reads. releaseBookingItem refuses it for the mirror-image reason.
  // (UNFULFILLED is NOT refused: see the revive at the write below.)
  if (bookingItem.status === 'SUBSTITUTED') {
    return refuse(409, {
      ok: false,
      error: 'item-substituted',
      reason: 'that line was substituted out — pick the unit on the line that replaced it',
    })
  }

  // ── The outgoing unit, on a swap ──────────────────────────────────
  // Resolved first: it must not count against capacity, must not crowd
  // the window resolver into a different block, and its order is what
  // the replacement inherits.
  let outgoing: { id: string; assetId: string; status: string; orderId: string | null; orderLineItemId: string | null; startDate: Date; endDate: Date } | null = null
  if (args.replaceAssetId) {
    const found = bookingItem.assignments.find((a) => a.assetId === args.replaceAssetId)
    if (!found) {
      return refuse(404, {
        ok: false,
        error: 'replace-not-assigned',
        reason: 'the unit being swapped out is not on this hold',
      })
    }
    if (found.status === 'CHECKED_OUT') {
      return refuse(409, {
        ok: false,
        error: 'replace-checked-out',
        reason: 'that unit is checked out — use the return flow, not a pick change',
      })
    }
    outgoing = found
  }
  /** Everything still holding a slot once the outgoing unit steps aside. */
  const standingAssignments = bookingItem.assignments.filter((a) => a.id !== outgoing?.id)

  // ── Which order, and therefore which window? ──────────────────────
  // The caller may name an order (a booking can carry lines from more than
  // one); it is verified against the job so a stray id cannot attach a unit
  // to somebody else's order. With exactly one live order it is stamped
  // rather than asked.
  const candidateOrders = await prisma.order.findMany({
    where: { jobId: bookingItem.booking.jobId ?? undefined, status: { notIn: ['CANCELLED'] }, archivedAt: null },
    select: { id: true },
  })
  const candidateIds = new Set(candidateOrders.map((o) => o.id))
  const requestedOrderId = typeof args.orderId === 'string' ? args.orderId : null
  if (requestedOrderId && !candidateIds.has(requestedOrderId)) {
    return refuse(400, { ok: false, error: 'order-not-on-job', reason: 'that order does not belong to this booking’s job' })
  }
  // A swap inherits the outgoing unit's order — the yard's "which truck
  // is on which order" marker should survive a change of truck without
  // being re-picked.
  const inheritedOrderId = outgoing?.orderId && candidateIds.has(outgoing.orderId) ? outgoing.orderId : null
  const attachOrderId =
    requestedOrderId ?? inheritedOrderId ?? (candidateOrders.length === 1 ? candidateOrders[0].id : null)

  // ── Which LINE of that order? ─────────────────────────────────────
  // Named by the caller, or inherited on a swap (the replacement truck is
  // the same line's truck). A line that is not on the attached order is
  // refused outright rather than silently dropped — a wrong stamp would
  // print "Cube 34" on the wrong line and release the wrong truck later.
  const requestedLineId = typeof args.orderLineItemId === 'string' && args.orderLineItemId ? args.orderLineItemId : null
  let attachLineId: string | null = null
  if (requestedLineId) {
    const line = await prisma.orderLineItem.findUnique({ where: { id: requestedLineId }, select: { orderId: true } })
    if (!line || (attachOrderId && line.orderId !== attachOrderId) || (!attachOrderId && !candidateIds.has(line.orderId))) {
      return refuse(400, { ok: false, error: 'line-not-on-order', reason: 'that order line does not belong to the order this unit is going out on' })
    }
    attachLineId = requestedLineId
  } else if (outgoing?.orderLineItemId && (attachOrderId === outgoing.orderId || !attachOrderId)) {
    attachLineId = outgoing.orderLineItemId
  }

  // ── Which DAYS? ───────────────────────────────────────────────────
  // Not the booking envelope (it spans every order on the job) and not
  // the order span either (one order carries two date blocks of the same
  // class as a matter of routine). The block being filled is the truth;
  // `resolveAssignWindow` is the one place that decides it, shared with
  // the picker so the list and the button cannot disagree. See
  // assignWindow.ts for what each wider window cost.
  const orderForWindow = attachOrderId
    ? await prisma.order.findUnique({
        where: { id: attachOrderId },
        select: {
          startDate: true,
          endDate: true,
          lineItems: { select: { pickupDate: true, returnDate: true } },
          booking: { select: { startDate: true, endDate: true, status: true } },
        },
      })
    : null
  const orderWindow = orderForWindow ? deriveOrderWindow({ ...orderForWindow, job: { bookings: [] } }) : null
  const blocks = quotedBlocks(
    await quotedLinesForHold({
      categoryId: bookingItem.categoryId,
      jobId: bookingItem.booking.jobId,
      orderId: attachOrderId,
    }),
  )
  const asDate = (v: Date | string | null | undefined): Date | null => {
    if (!v) return null
    const d = v instanceof Date ? v : new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const resolved = resolveAssignWindow({
    hold: { start: bookingItem.booking.startDate, end: bookingItem.booking.endDate },
    orderWindow,
    blocks,
    assignments: standingAssignments,
    // A swap with no window named lands on the outgoing unit's own days —
    // the block it is coming off is the block being re-covered.
    requested: {
      start: asDate(args.windowStart) ?? outgoing?.startDate ?? null,
      end: asDate(args.windowEnd) ?? outgoing?.endDate ?? null,
    },
  })
  const windowStart = resolved.start
  const windowEnd = resolved.end

  // Only the assignments that TOUCH this window occupy it.
  const occupying = standingAssignments.filter((a) => overlaps(a, windowStart, windowEnd))
  // Swapping across blocks would uncover the block the outgoing unit is
  // on to cover this one — two decisions wearing one button.
  if (outgoing && !overlaps(outgoing, windowStart, windowEnd)) {
    return refuse(409, {
      ok: false,
      error: 'replace-other-block',
      reason: `that unit is booked ${formatCalendarRange(outgoing.startDate, outgoing.endDate)}, not ${formatCalendarRange(windowStart, windowEnd)} — swap it on its own dates`,
    })
  }
  if (occupying.some((a) => a.assetId === args.assetId)) {
    return refuse(409, { error: 'this asset is already assigned to this booking item for those dates' })
  }
  if (occupying.length >= bookingItem.quantity) {
    return refuse(409, {
      error: 'booking item is already fully assigned',
      assignedCount: occupying.length,
      quantity: bookingItem.quantity,
    })
  }

  const asset = await prisma.asset.findUnique({
    where: { id: args.assetId },
    select: { id: true, unitName: true, tier: true, categoryId: true, isActive: true, status: true },
  })
  if (!asset) return refuse(404, { error: 'asset not found' })
  if (asset.categoryId !== bookingItem.categoryId) {
    return refuse(400, { error: 'asset belongs to a different category' })
  }
  if (!asset.isActive || ['MAINTENANCE', 'RETIRED', 'SOLD', 'STOLEN', 'TOTALED'].includes(asset.status)) {
    return refuse(409, { error: 'asset is not serviceable', status: asset.status })
  }
  // Second serviceability gate, matching getCategoryAvailability: the
  // "refer to maintenance" / "mark N/A" actions open a MaintenanceRecord
  // and never touch Asset.status, so the check above passes a truck the
  // fleet has greyed. The refusal belongs on the write.
  {
    const oos = await outOfServiceByAsset([asset.id], windowStart, windowEnd)
    const entry = oos.get(asset.id)
    if (entry) {
      return refuse(409, {
        error: 'asset is out of service',
        reason: `${asset.unitName} is out of service for these dates — ${entry.reason}. Clear it in maintenance first.`,
        since: entry.since,
      })
    }
  }

  // Re-check conflict on this specific asset for the window resolved above.
  const lookaround = Math.max(1, bufferDays + 1)
  const queryStart = new Date(windowStart.getTime() - lookaround * 86_400_000)
  const queryEnd = new Date(windowEnd.getTime() + lookaround * 86_400_000)

  // Active assignments WITH their BookingItem.holdRank, so a true
  // capacity block (a rank-1 holds the unit) reads differently from a
  // "backup has dibs" block (only rank-2+ holds it).
  const assignmentsDetailed = await prisma.bookingAssignment.findMany({
    where: {
      assetId: args.assetId,
      status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
      startDate: { lte: queryEnd },
      endDate: { gte: queryStart },
    },
    select: {
      assetId: true,
      startDate: true,
      endDate: true,
      bookingItem: { select: { holdRank: true, booking: { select: { jobName: true } } } },
    },
  })

  const serviceable: ServiceableAsset[] = [{ id: asset.id, unitName: asset.unitName, tier: asset.tier }]
  const stateRows = computeUnitStates(
    serviceable,
    assignmentsDetailed.map((a) => ({ assetId: a.assetId, startDate: a.startDate, endDate: a.endDate })) as AssignmentWindow[],
    windowStart,
    windowEnd,
    bufferDays,
  )
  const state = stateRows[0]?.state ?? 'free'

  const overlappingActive = assignmentsDetailed.filter((a) => a.startDate <= windowEnd && a.endDate >= windowStart)
  const hasPrimaryHolder = overlappingActive.some((a) => a.bookingItem.holdRank === 1)
  const backupCountOnUnit = overlappingActive.filter((a) => a.bookingItem.holdRank >= 2).length

  // Rank-aware overlap guard. Rank-1 cannot bind to a unit that is
  // already held (double-book guard); rank-2+ may share the unit with
  // whatever is already there, queueing behind. The buffer warning is
  // also rank-gated — backups silent-skip it. An orphaned backup (a
  // unit holding only a rank-2 after a primary released without
  // promoting) still blocks a new rank-1: promote the waiting backup
  // rather than let a new primary jump the queue.
  const isPrimaryItem = bookingItem.holdRank === 1

  // A refusal has to say WHAT is in the way. "asset has a hard overlap on
  // this window" sent Oliver to Wes with a screenshot on 2026-09-14 — the
  // van he was told about came back the day BEFORE his dates, and nothing
  // on screen said which dates HQ thought it was checking. Name the unit,
  // the days it is out, the job it is out on, and the window being filled.
  const windowLabel = formatCalendarRange(windowStart, windowEnd)
  const whereItIs = (a: (typeof overlappingActive)[number]): string => {
    const on = a.bookingItem.booking?.jobName
    return `${formatCalendarRange(a.startDate, a.endDate)}${on ? ` on ${on}` : ''}`
  }

  if (state === 'booked' && isPrimaryItem) {
    if (!hasPrimaryHolder && backupCountOnUnit > 0) {
      return refuse(409, {
        ok: false,
        error: 'backup-has-dibs',
        reason: `${asset.unitName} has a ${backupCountOnUnit === 1 ? '2nd hold' : `${backupCountOnUnit} backup hold(s)`} waiting on ${windowLabel}; promote or release ${backupCountOnUnit === 1 ? 'it' : 'one'} first`,
        state,
        backupCountOnUnit,
      })
    }
    return refuse(409, {
      ok: false,
      error: 'over-capacity',
      reason: `${asset.unitName} is already out ${overlappingActive.map(whereItIs).join('; ')} — those days overlap ${windowLabel}. Promote an existing backup instead of stacking a new primary.`,
      state,
      backupCountOnUnit,
      window: { start: windowStart, end: windowEnd, source: resolved.source },
      conflicts: overlappingActive.map((a) => ({
        start: a.startDate,
        end: a.endDate,
        jobName: a.bookingItem.booking?.jobName ?? null,
      })),
    })
  }
  if (state === 'buffer' && isPrimaryItem && !args.bufferOverride) {
    // The adjacent rental, not an overlapping one — that is what "tight"
    // means: it comes back (or goes out) with no clear turnaround day.
    const before = assignmentsDetailed
      .filter((a) => a.endDate < windowStart)
      .sort((a, b) => b.endDate.getTime() - a.endDate.getTime())[0]
    const after = assignmentsDetailed
      .filter((a) => a.startDate > windowEnd)
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0]
    const detail = before
      ? `${asset.unitName} comes back ${formatCalendarDate(before.endDate)}${before.bookingItem.booking?.jobName ? ` from ${before.bookingItem.booking.jobName}` : ''}, with no clear day before this ${formatCalendarDate(windowStart)} pickup.`
      : after
        ? `${asset.unitName} goes back out ${formatCalendarDate(after.startDate)}${after.bookingItem.booking?.jobName ? ` on ${after.bookingItem.booking.jobName}` : ''}, with no clear day after this ${formatCalendarDate(windowEnd)} return.`
        : `${asset.unitName} has no clear turnaround day around ${windowLabel}.`
    return refuse(409, {
      ok: false,
      error: 'buffer-encroachment',
      reason: `${detail} Assign it anyway if the turnaround is covered.`,
      needsOverride: true,
      state,
      window: { start: windowStart, end: windowEnd, source: resolved.source },
    })
  }

  const result = await prisma.$transaction(async (tx) => {
    // Same transaction: the block is never left uncovered between the two.
    if (outgoing) await tx.bookingAssignment.delete({ where: { id: outgoing.id } })
    const created = await tx.bookingAssignment.create({
      data: {
        bookingItemId: bookingItem.id,
        assetId: asset.id,
        startDate: windowStart,
        endDate: windowEnd,
        status: 'ASSIGNED',
        orderId: attachOrderId,
        orderLineItemId: attachLineId,
      },
      select: {
        id: true,
        status: true,
        startDate: true,
        endDate: true,
        orderLineItemId: true,
        asset: { select: { id: true, unitName: true, tier: true } },
      },
    })
    // Counted for THIS window — the item is "assigned" when the block being
    // booked has its trucks, not when some other date block does.
    const newAssignedCount = occupying.length + 1
    const covered = newAssignedCount >= bookingItem.quantity
    let updatedItemStatus: string = bookingItem.status
    // A RELEASED line that someone is now picking a unit for is being
    // re-asserted — so say so on the line, don't leave the truck bound to
    // a dead row.
    //
    // This used to fall through: the status write only ever fired on
    // REQUESTED, so an assign onto an UNFULFILLED line created a live
    // ASSIGNED assignment and left the line released. SR-JOB-0391 spent
    // 2026-09-15 that way — Cargo 35 bound for the morning under a job
    // the board painted "Released — nothing is still held", because
    // holdsFullyReleased reads the LINE and the yard reads the
    // ASSIGNMENT. Capacity was counted from neither.
    //
    // Revived to ASSIGNED only when this window is actually covered;
    // otherwise REQUESTED, which puts it back in the assign lane where a
    // part-covered line belongs. The whole-line release is reversible by
    // definition (nothing else undoes one — `promote` refuses an
    // UNFULFILLED row), so refusing here would strand the rep instead.
    if (bookingItem.status === 'UNFULFILLED') {
      const revived = covered ? ('ASSIGNED' as const) : ('REQUESTED' as const)
      await tx.bookingItem.update({ where: { id: bookingItem.id }, data: { status: revived } })
      updatedItemStatus = revived
    } else if (covered && bookingItem.status === 'REQUESTED') {
      await tx.bookingItem.update({ where: { id: bookingItem.id }, data: { status: 'ASSIGNED' } })
      updatedItemStatus = 'ASSIGNED'
    }
    return { created, newAssignedCount, updatedItemStatus }
  })

  // The mirror of 'booking_item.released'. A hold coming BACK is as much
  // of an event as one going away, and without this the trail would show
  // a release with no matching revival and a line that is somehow live
  // again. Non-fatal and after the fact, same contract as the release.
  if (bookingItem.status === 'UNFULFILLED') {
    try {
      await prisma.auditLog.create({
        data: {
          userId: args.actor?.userId ?? null,
          action: 'booking_item.revived_by_assign',
          entityType: 'BookingItem',
          entityId: bookingItem.id,
          oldValues: { status: 'UNFULFILLED', quantity: bookingItem.quantity },
          newValues: {
            status: result.updatedItemStatus,
            quantity: bookingItem.quantity,
            assignedCount: result.newAssignedCount,
            unit: asset.unitName,
            orderId: attachOrderId,
            source: args.actor?.source ?? 'unattributed',
          },
        },
      })
    } catch (err) {
      console.error('[assignUnit] revive audit failed:', err instanceof Error ? err.message : err)
    }
  }

  return {
    ok: true,
    assignment: result.created,
    bookingItem: {
      id: bookingItem.id,
      quantity: bookingItem.quantity,
      status: result.updatedItemStatus,
      assignedCount: result.newAssignedCount,
      remaining: Math.max(0, bookingItem.quantity - result.newAssignedCount),
    },
    bufferOverrideUsed: state === 'buffer' && Boolean(args.bufferOverride),
    window: {
      start: windowStart.toISOString().slice(0, 10),
      end: windowEnd.toISOString().slice(0, 10),
      source: resolved.source,
    },
    replacedAssetId: outgoing?.assetId ?? null,
  }
}
