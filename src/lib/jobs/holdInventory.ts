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
import { releaseBookingItem } from '@/lib/scheduling/releaseBookingItem'
// A hold row is not always a whole BookingItem — a line holding two
// assigned trucks lists one row per truck, so releasing one leaves the
// other alone (Wes 2026-09-10). `holdRowId` / `parseHoldRowId` are the
// two ends of that addressing.
import { holdRowId, parseHoldRowId } from '@/lib/scheduling/holdRelease'
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
  /**
   * The id to hand back to POST /holds. For a PARTNER row it is the
   * SubRental id. For an OURS row it is a HOLD ROW id, which is NOT
   * always a bare BookingItem id — see `holdRowId`: a line holding two
   * assigned trucks emits one row per truck, so releasing one leaves the
   * other alone (Wes 2026-09-10).
   */
  id: string
  /** OURS: the BookingItem this row belongs to. */
  bookingItemId: string | null
  /** OURS: the specific unit this row releases, when it names one. */
  assetId: string | null
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
        select: {
          startDate: true,
          endDate: true,
          assetId: true,
          asset: { select: { id: true, unitName: true } },
        },
      },
    },
    orderBy: { holdRank: 'asc' },
  })

  // ONE ROW PER THING A HUMAN CAN HAND BACK — not one row per database
  // line. A "2× Motorhome" item with Cube 10 and Cube 12 picked used to
  // be a single tick that released both; the rep who only wanted Cube 12
  // back had no way to say so, and the sibling truck came off the board
  // with it (Wes 2026-09-10). So an item with units picked emits one row
  // per unit, plus a pooled row for any slots still unassigned. An item
  // with nothing picked stays exactly one row, keyed by the item id.
  const ours: HeldUnit[] = items.flatMap((it) => {
    const lineLabel =
      it.category?.name ?? it.catalogItem?.description ?? it.catalogItem?.code ?? 'Unnamed category'
    const rankNote =
      it.holdRank === 1 ? null : `${holdRankLabel(it.holdRank)} Hold — queued behind another production`

    const unitRows: HeldUnit[] = it.assignments.map((a) => ({
      kind: 'OURS' as const,
      id: holdRowId(it.id, { assetId: a.assetId }),
      bookingItemId: it.id,
      assetId: a.assetId,
      label: `${a.asset?.unitName || 'unnamed unit'} · ${lineLabel}`,
      quantity: 1,
      // The assignment's own window is the truth for a picked unit; the
      // booking envelope only answers for a slot nobody has picked yet.
      startDate: iso(a.startDate ?? it.booking.startDate),
      endDate: iso(a.endDate ?? it.booking.endDate),
      // A truck with someone's name on it is committed, whatever the rank.
      firm: true,
      detail: rankNote ? `Assigned · ${rankNote}` : 'Assigned to this job',
      assignedUnits: [a.asset?.unitName || 'unnamed unit'],
      vendorName: null,
      notifiesVendor: false,
    }))

    const pooledSlots = Math.max(0, it.quantity - it.assignments.length)
    if (unitRows.length === 0) {
      // Nothing picked — the whole line IS the row, and its id stays the
      // bare BookingItem id so older callers keep hitting the same thing.
      return [
        {
          kind: 'OURS' as const,
          id: it.id,
          bookingItemId: it.id,
          assetId: null,
          label: lineLabel,
          quantity: it.quantity,
          startDate: iso(it.booking.startDate),
          endDate: iso(it.booking.endDate),
          firm: it.holdRank === 1,
          detail: rankNote ?? 'Hold, no unit assigned yet',
          assignedUnits: [],
          vendorName: null,
          notifiesVendor: false,
        },
      ]
    }
    if (pooledSlots === 0) return unitRows
    return [
      ...unitRows,
      {
        kind: 'OURS' as const,
        id: holdRowId(it.id, 'pool'),
        bookingItemId: it.id,
        assetId: null,
        label: lineLabel,
        quantity: pooledSlots,
        startDate: iso(it.booking.startDate),
        endDate: iso(it.booking.endDate),
        firm: it.holdRank === 1,
        detail: rankNote ?? 'Still held, no unit picked yet',
        assignedUnits: [],
        vendorName: null,
        notifiesVendor: false,
      },
    ]
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
      bookingItemId: null,
      assetId: null,
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
 * Our own units go through `releaseBookingItem` — the same function
 * /api/scheduling/booking-items/[id]/release and the Planyo auto-release
 * cron call, so there is one recipe rather than three. Partner units go
 * through cancelSubRentalsById so the release, the partner's email and
 * the audit row stay identical to the order-cancellation path.
 *
 * PER-UNIT (Wes 2026-09-10): an id may name a whole line, one assigned
 * unit, or a line's unassigned remainder — see `holdRowId`. Ids for the
 * same BookingItem are gathered first, so ticking both trucks on a
 * 2× line resolves to ONE whole-line release rather than two partials
 * racing each other on the same row.
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
  const wantRows = Array.from(new Set(selection.bookingItemIds ?? []))
  const wantSubs = Array.from(new Set(selection.subRentalIds ?? []))
  if (wantRows.length === 0 && wantSubs.length === 0) return out

  // Gather the ticked rows back onto the BookingItems they came from.
  // Two unit rows on the same line have to be decided together — released
  // one at a time they would each re-read a quantity the other just
  // changed.
  const byItem = new Map<
    string,
    { wholeLine: boolean; assetIds: Set<string>; pooled: boolean; rowIds: string[] }
  >()
  for (const rowId of wantRows) {
    const parsed = parseHoldRowId(rowId)
    const entry = byItem.get(parsed.bookingItemId) ?? {
      wholeLine: false, assetIds: new Set<string>(), pooled: false, rowIds: [],
    }
    entry.rowIds.push(rowId)
    if (parsed.wholeLine) entry.wholeLine = true
    if (parsed.pooled) entry.pooled = true
    if (parsed.assetId) entry.assetIds.add(parsed.assetId)
    byItem.set(parsed.bookingItemId, entry)
  }

  try {
    // ── Ours ────────────────────────────────────────────────────────────
    const items = byItem.size
      ? await prisma.bookingItem.findMany({
          where: {
            id: { in: Array.from(byItem.keys()) },
            status: { in: [...LIVE_ITEM_STATUSES] },
            booking: { jobId, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
          },
          select: {
            id: true, status: true, holdRank: true, bookingId: true, quantity: true,
            assignments: {
              where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
              select: { assetId: true },
            },
          },
        })
      : []
    const foundItemIds = new Set(items.map((i) => i.id))
    for (const [itemId, sel] of byItem) {
      if (!foundItemIds.has(itemId)) out.skipped.push(...sel.rowIds)
    }

    const touchedBookings = new Set<string>()
    for (const item of items) {
      const sel = byItem.get(item.id)!
      const assignedIds = item.assignments.map((a) => a.assetId)
      // A unit row whose truck is no longer on this line (someone else
      // released or reassigned it while the modal sat open) is skipped and
      // named — never widened into "release the line".
      const stale = Array.from(sel.assetIds).filter((id) => !assignedIds.includes(id))
      out.skipped.push(...stale.map((assetId) => holdRowId(item.id, { assetId })))
      const liveAssetIds = Array.from(sel.assetIds).filter((id) => assignedIds.includes(id))
      const pooledSlots = sel.pooled ? Math.max(0, item.quantity - assignedIds.length) : 0
      const namedOnly = !sel.wholeLine && (liveAssetIds.length > 0 || pooledSlots > 0)
      if (!sel.wholeLine && !namedOnly) continue // every row on it was stale

      const outcome = await releaseBookingItem(
        item.id,
        namedOnly ? { assetIds: liveAssetIds, pooledSlots } : {},
      )
      if (!outcome.ok) {
        out.skipped.push(...sel.rowIds)
        continue
      }
      // Count what the HUMAN ticked and we acted on, not database rows —
      // "2 holds released" beside two ticked trucks is the honest number.
      out.releasedOurs += sel.wholeLine
        ? 1
        : liveAssetIds.length + (pooledSlots > 0 ? 1 : 0)
      out.unitsFreed += outcome.swappedAssignmentCount
      touchedBookings.add(item.bookingId)
      await prisma.auditLog.create({
        data: {
          action: 'job.hold_released',
          entityType: 'BookingItem',
          entityId: item.id,
          userId: actorId,
          oldValues: { status: item.status, holdRank: item.holdRank, quantity: item.quantity },
          newValues: {
            status: outcome.status,
            quantity: outcome.quantity,
            mode: outcome.mode,
            releasedAssetIds: namedOnly ? liveAssetIds : assignedIds,
            assignmentsSwapped: outcome.swappedAssignmentCount,
            jobId,
          },
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
