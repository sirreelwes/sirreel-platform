/**
 * Everything a job is holding, and how to hand any of it back
 * (Wes 2026-09-08).
 *
 * THE GAP THIS CLOSES. "Mark job lost" released exactly one thing: the
 * unpromoted rank-2 soft holds created by sending a quote, and only on
 * orders still sitting at DRAFT/SENT (see releaseHoldsOnLost). Two whole
 * categories of held equipment were never touched by it:
 *
 *   · OUR OWN units on a job that got past quoting — a BOOKED order's
 *     holds are rank 1, or have a truck assigned to them. Marking that
 *     job lost left every unit reading as spoken-for on the board.
 *   · PARTNER units, always. A SubRental is a different table with a
 *     different lifecycle; nothing in either mark-lost path looked at
 *     one. King Kong kept the restroom trailer blocked on their calendar
 *     and never got a word from us.
 *
 * So the release has to be its own thing, listing what is actually held
 * and letting a human choose. Wes: "theoretically, they could release the
 * restroom trailer and not the motorhome ... but in a case like this where
 * [the client] is releasing the job completely there needs to be a button
 * for that."
 *
 * WHAT THIS DOES NOT DECIDE. It never infers that a hold should go. The
 * caller passes ids a human ticked; this module's job is to (a) tell the
 * truth about what is held, including the parts that releasing will email
 * a partner about, and (b) release exactly what was named, using the
 * canonical recipes rather than a second private one.
 */

import { prisma } from '@/lib/prisma'
import { holdRankLabel } from '@/lib/scheduling/holdRanks'
import {
  cancelSubRentalsById,
  jobLifecycleContext,
  RELEASABLE_SUB_RENTAL_STATUSES,
  type LifecycleNoticeOutcome,
} from '@/lib/sub-rentals/lifecycleNotices'

/** Assignment statuses that mean a real unit is still committed. */
const ACTIVE_ASSIGNMENT_STATUSES = ['ASSIGNED', 'CHECKED_OUT'] as const

/** BookingItem statuses a hold can still be released from. */
const LIVE_ITEM_STATUSES = ['REQUESTED', 'ASSIGNED'] as const

/**
 * Booking statuses that are still just a RESERVATION. Emptying one of
 * these cancels it, so the board stops showing a live booking with
 * nothing on it. ACTIVE is excluded on purpose — the units are out.
 */
const CANCELLABLE_BOOKING_STATUSES = ['REQUEST', 'AI_REVIEW', 'PENDING_APPROVAL', 'CONFIRMED'] as const

export interface HeldUnit {
  /** OURS = a unit off our own fleet. PARTNER = a sub-rented unit. */
  kind: 'OURS' | 'PARTNER'
  /** BookingItem id (OURS) or SubRental id (PARTNER). */
  id: string
  label: string
  quantity: number
  startDate: string | null
  endDate: string | null
  /**
   * Is anyone treating this as committed rather than pencilled in?
   * OURS: a rank-1 hold, or one with a truck actually assigned.
   * PARTNER: the partner has confirmed the hold, or been asked to hold.
   * Drives the "this is a real commitment" warning on the confirm step —
   * it never blocks the release.
   */
  firm: boolean
  /** Human-readable state, shown next to the row. */
  detail: string
  /** OURS: the units assigned to this hold, by name. */
  assignedUnits: string[]
  /** PARTNER: whose unit it is. */
  vendorName: string | null
  /** Releasing this will send the partner a cancellation email. */
  notifiesVendor: boolean
}

export interface JobHoldInventory {
  jobId: string
  jobCode: string
  jobName: string
  ours: HeldUnit[]
  partner: HeldUnit[]
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

/**
 * Every live hold on a job, ours and partners', as one list a human can
 * tick through.
 *
 * Scope note: a SubRental reaches a job either directly (`jobId` — an
 * estimate that exists before any order does) or through its order. Both
 * are included, or a partner unit quoted at estimate time would be
 * invisible to the very screen meant to release it.
 */
export async function getJobHoldInventory(jobId: string): Promise<JobHoldInventory | null> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, jobCode: true, name: true },
  })
  if (!job) return null

  const items = await prisma.bookingItem.findMany({
    where: {
      status: { in: [...LIVE_ITEM_STATUSES] },
      booking: { jobId, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
    },
    select: {
      id: true, quantity: true, holdRank: true, status: true,
      category: { select: { name: true } },
      catalogItem: { select: { description: true, code: true } },
      booking: { select: { bookingNumber: true, startDate: true, endDate: true } },
      assignments: {
        where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
        select: { startDate: true, endDate: true, asset: { select: { unitName: true } } },
      },
    },
    orderBy: { holdRank: 'asc' },
  })

  const ours: HeldUnit[] = items.map((it) => {
    const assignedUnits = it.assignments.map(
      (a) => a.asset?.unitName || 'unnamed unit',
    )
    // Assignment dates are the precise window a unit is committed for;
    // the booking envelope is the fallback for an unassigned hold.
    const starts = it.assignments.map((a) => a.startDate).filter(Boolean) as Date[]
    const ends = it.assignments.map((a) => a.endDate).filter(Boolean) as Date[]
    const firm = it.holdRank === 1 || assignedUnits.length > 0
    return {
      kind: 'OURS' as const,
      id: it.id,
      label: it.category?.name ?? it.catalogItem?.description ?? it.catalogItem?.code ?? 'Unnamed category',
      quantity: it.quantity,
      startDate: iso(starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : it.booking.startDate),
      endDate: iso(ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : it.booking.endDate),
      firm,
      detail: assignedUnits.length
        ? `Assigned · ${assignedUnits.join(', ')}`
        : it.holdRank === 1
          ? 'Hold, no unit assigned yet'
          : `${holdRankLabel(it.holdRank)} Hold — queued behind another production`,
      assignedUnits,
      vendorName: null,
      notifiesVendor: false,
    }
  })

  const subs = await prisma.subRental.findMany({
    where: {
      status: { in: [...RELEASABLE_SUB_RENTAL_STATUSES] },
      OR: [{ jobId }, { order: { jobId } }],
    },
    select: {
      id: true, status: true, itemDescription: true, quantity: true,
      startDate: true, endDate: true,
      vendorConfirmedAt: true, vendorHoldRequestedAt: true, vendorNotifiedAt: true,
      vendorCancelNotifiedAt: true,
      subcontractedVehicle: { select: { name: true } },
      vendor: { select: { name: true, email: true, poEmail: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const partner: HeldUnit[] = subs.map((s) => {
    // Mirrors the notice rule in lifecycleNotices exactly: a partner who
    // was never told anything has nothing to un-hear, and one already
    // told is not told twice. Getting this wrong on the confirm screen
    // would promise an email that never sends.
    const wasTold = !!(s.vendorHoldRequestedAt || s.vendorNotifiedAt)
    const hasEmail = !!(s.vendor.poEmail ?? s.vendor.email)
    return {
      kind: 'PARTNER' as const,
      id: s.id,
      label: s.subcontractedVehicle?.name ?? s.itemDescription,
      quantity: s.quantity,
      startDate: iso(s.startDate),
      endDate: iso(s.endDate),
      firm: !!s.vendorConfirmedAt || !!s.vendorHoldRequestedAt,
      detail: s.vendorConfirmedAt
        ? 'Partner confirmed the hold'
        : s.vendorHoldRequestedAt
          ? 'Partner asked to hold, not confirmed yet'
          : s.status === 'ESTIMATED'
            ? 'Pencilled in, partner not asked to hold'
            : 'Hold requested',
      assignedUnits: [],
      vendorName: s.vendor.name,
      notifiesVendor: wasTold && hasEmail && !s.vendorCancelNotifiedAt,
    }
  })

  return { jobId: job.id, jobCode: job.jobCode, jobName: job.name, ours, partner }
}

export interface ReleaseSelection {
  bookingItemIds?: string[]
  subRentalIds?: string[]
}

export interface ReleaseResult {
  releasedOurs: number
  /** Active assignments flipped to SWAPPED — real trucks handed back. */
  unitsFreed: number
  bookingsCancelled: number
  releasedPartner: number
  partnerOutcomes: LifecycleNoticeOutcome[]
  /** Ids that were asked for but do not belong to this job, or are already
   *  released. Reported, never silently dropped. */
  skipped: string[]
  error: string | null
}

/**
 * Release exactly the holds named, after re-checking that every one of
 * them belongs to THIS job.
 *
 * The ownership re-check is the point: ids arrive from a browser, and
 * releasing a BookingItem is destructive to someone's reservation. An id
 * that does not resolve within the job is skipped and reported rather
 * than acted on.
 *
 * Our own units use the canonical release recipe (active assignments →
 * SWAPPED, item → UNFULFILLED) in one transaction per item — the same
 * pair as /api/scheduling/booking-items/[id]/release. Partner units go
 * through cancelSubRentalsById so the release, the partner's email and
 * the audit row stay identical to the order-cancellation path.
 *
 * NON-FATAL on the partner side: the sub-rental status flip is durable
 * whatever the mail does, and a failed send comes back as a warning the
 * caller can show, so a human knows to phone.
 */
export async function releaseJobHolds(
  jobId: string,
  selection: ReleaseSelection,
  actorId: string | null,
): Promise<ReleaseResult> {
  const out: ReleaseResult = {
    releasedOurs: 0, unitsFreed: 0, bookingsCancelled: 0,
    releasedPartner: 0, partnerOutcomes: [], skipped: [], error: null,
  }
  const wantItems = Array.from(new Set(selection.bookingItemIds ?? []))
  const wantSubs = Array.from(new Set(selection.subRentalIds ?? []))
  if (wantItems.length === 0 && wantSubs.length === 0) return out

  try {
    // ── Ours ────────────────────────────────────────────────────────────
    const items = wantItems.length
      ? await prisma.bookingItem.findMany({
          where: {
            id: { in: wantItems },
            status: { in: [...LIVE_ITEM_STATUSES] },
            booking: { jobId, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
          },
          select: { id: true, status: true, holdRank: true, bookingId: true },
        })
      : []
    const foundItemIds = new Set(items.map((i) => i.id))
    out.skipped.push(...wantItems.filter((id) => !foundItemIds.has(id)))

    const touchedBookings = new Set<string>()
    for (const item of items) {
      const [swapped] = await prisma.$transaction([
        prisma.bookingAssignment.updateMany({
          where: { bookingItemId: item.id, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
          data: { status: 'SWAPPED' },
        }),
        prisma.bookingItem.update({ where: { id: item.id }, data: { status: 'UNFULFILLED' } }),
      ])
      out.releasedOurs++
      out.unitsFreed += swapped.count
      touchedBookings.add(item.bookingId)
      await prisma.auditLog.create({
        data: {
          action: 'job.hold_released',
          entityType: 'BookingItem',
          entityId: item.id,
          userId: actorId,
          oldValues: { status: item.status, holdRank: item.holdRank },
          newValues: { status: 'UNFULFILLED', assignmentsSwapped: swapped.count, jobId },
        },
      }).catch(() => {})
    }

    // A reservation with nothing live left on it is not a reservation.
    // Only while it is still just a booking on paper — an ACTIVE one has
    // units in the field and is not this function's to close.
    for (const bookingId of touchedBookings) {
      const liveLeft = await prisma.bookingItem.count({
        where: { bookingId, status: { in: [...LIVE_ITEM_STATUSES] } },
      })
      if (liveLeft > 0) continue
      const res = await prisma.booking.updateMany({
        where: { id: bookingId, status: { in: [...CANCELLABLE_BOOKING_STATUSES] } },
        data: { status: 'CANCELLED' },
      })
      out.bookingsCancelled += res.count
    }

    // ── Partners ────────────────────────────────────────────────────────
    if (wantSubs.length) {
      const inScope = await prisma.subRental.findMany({
        where: {
          id: { in: wantSubs },
          status: { in: [...RELEASABLE_SUB_RENTAL_STATUSES] },
          OR: [{ jobId }, { order: { jobId } }],
        },
        select: { id: true },
      })
      const inScopeIds = inScope.map((s) => s.id)
      const found = new Set(inScopeIds)
      out.skipped.push(...wantSubs.filter((id) => !found.has(id)))

      if (inScopeIds.length) {
        const ctx = await jobLifecycleContext(jobId)
        if (!ctx) {
          out.error = 'job not found for partner notices'
        } else {
          out.partnerOutcomes = await cancelSubRentalsById(inScopeIds, ctx)
          out.releasedPartner = out.partnerOutcomes.length
        }
      }
    }

    return out
  } catch (e) {
    return { ...out, error: e instanceof Error ? e.message : 'release failed' }
  }
}
