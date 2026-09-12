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
}

export interface AssignedUnit {
  id: string
  status: string
  startDate: Date
  endDate: Date
  asset: { id: string; unitName: string; tier: string }
}

export type AssignUnitResult =
  | {
      ok: true
      assignment: AssignedUnit
      bookingItem: { id: string; quantity: number; status: string; assignedCount: number; remaining: number }
      bufferOverrideUsed: boolean
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
        select: { id: true, assetId: true, startDate: true, endDate: true },
      },
    },
  })
  if (!bookingItem) return refuse(404, { error: 'booking item not found' })

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
  const attachOrderId = requestedOrderId ?? (candidateOrders.length === 1 ? candidateOrders[0].id : null)

  // The BOOKING ENVELOPE spans every order on the job: quote a truck for
  // Sep 22–24 and another for Oct 6–10 and the envelope is Sep 22 → Oct 10.
  // Binding against that holds a truck for eighteen days to cover three —
  // and, worse, makes the shared item read "already fully assigned" for the
  // second block, so that order could never get a unit by ANY route: not
  // the line-add, not the quote send, not the picker on the order page.
  // Oliver hit exactly that on SR-JOB-0364 (2026-09-12): he chose Cube 35,
  // got nothing, and the reservation board showed no truck for his dates.
  // The ORDER's own window is the truth; the envelope is the fallback when
  // no order is named (a gantt drag on a bare hold).
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
  const derivedWindow = orderForWindow ? deriveOrderWindow({ ...orderForWindow, job: { bookings: [] } }) : null
  const windowStart = derivedWindow?.start ?? bookingItem.booking.startDate
  const windowEnd = derivedWindow?.end ?? bookingItem.booking.endDate

  // Only the assignments that TOUCH this window occupy it.
  const occupying = bookingItem.assignments.filter((a) => overlaps(a, windowStart, windowEnd))
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
    select: { assetId: true, startDate: true, endDate: true, bookingItem: { select: { holdRank: true } } },
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

  if (state === 'booked' && isPrimaryItem) {
    if (!hasPrimaryHolder && backupCountOnUnit > 0) {
      return refuse(409, {
        ok: false,
        error: 'backup-has-dibs',
        reason: `this unit has a ${backupCountOnUnit === 1 ? '2nd hold' : `${backupCountOnUnit} backup hold(s)`} waiting; promote or release ${backupCountOnUnit === 1 ? 'it' : 'one'} first`,
        state,
        backupCountOnUnit,
      })
    }
    return refuse(409, {
      ok: false,
      error: 'over-capacity',
      reason: 'asset has a hard overlap on this window; promote any existing backup instead of stacking a new primary',
      state,
      backupCountOnUnit,
    })
  }
  if (state === 'buffer' && isPrimaryItem && !args.bufferOverride) {
    return refuse(409, {
      ok: false,
      error: 'buffer-encroachment',
      reason: 'asset is in buffer state for this window; pass bufferOverride=true to proceed',
      needsOverride: true,
      state,
    })
  }

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.bookingAssignment.create({
      data: {
        bookingItemId: bookingItem.id,
        assetId: asset.id,
        startDate: windowStart,
        endDate: windowEnd,
        status: 'ASSIGNED',
        orderId: attachOrderId,
      },
      select: {
        id: true,
        status: true,
        startDate: true,
        endDate: true,
        asset: { select: { id: true, unitName: true, tier: true } },
      },
    })
    // Counted for THIS window — the item is "assigned" when the block being
    // booked has its trucks, not when some other date block does.
    const newAssignedCount = occupying.length + 1
    let updatedItemStatus: string = bookingItem.status
    if (newAssignedCount >= bookingItem.quantity && bookingItem.status === 'REQUESTED') {
      await tx.bookingItem.update({ where: { id: bookingItem.id }, data: { status: 'ASSIGNED' } })
      updatedItemStatus = 'ASSIGNED'
    }
    return { created, newAssignedCount, updatedItemStatus }
  })

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
  }
}
