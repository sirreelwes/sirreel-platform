/**
 * Holds sync for post-BOOKED VEHICLES / STAGES line edits (Phase 2).
 *
 * The PARKING LOT comment from STEP 0 — "post-BOOKED line-item edits
 * do NOT propagate into BookingItem; double-book risk on add, phantom
 * hold on delete" — is closed by this module.
 *
 * Pattern mirrors the canonical hold-creation path at
 * `src/app/api/scheduling/holds/route.ts` (the only existing site
 * that creates `BookingItem` rows in the codebase — `bookOrder.ts`
 * does NOT create them). Reusing the SAME shape:
 *   - one `BookingItem` per (Booking, category, holdRank=1)
 *   - `quantity` accumulates as lines are added
 *   - `dailyRate` snapshotted from `AssetCategory.dailyRate` at create
 *   - `status='REQUESTED'` on initial create (operator promotes to
 *     `ASSIGNED` via the existing booking-items endpoints)
 *
 * Availability semantics — same `getCategoryAvailability` helper used
 * by the holds modal. The key invariant: `availableToHold` INCLUDES
 * the current Booking's existing REQUESTED holds, so when adding to
 * an existing order:
 *   - delta = new total qty - existing qty (>=0 means we're adding
 *     capacity; <0 means releasing)
 *   - if (delta > availability.availableToHold) → conflict
 *
 * Conflict detection in `findConflictingHolds` is DIFFERENT from the
 * capacity gate — it identifies the SPECIFIC other bookings the rep
 * would be stepping on, so the warning can name them ("Cube truck
 * already committed to SR-2026-0089 · Stranger Things S6 ·
 * 06/15–06/18"). The capacity gate alone says "you can't fit" without
 * saying who's in the way.
 *
 * Posture per ratification: WARN-with-override, NOT hard-block. At
 * pickup the truck is going out regardless of what the system thinks;
 * a hard block breaks reality. Override marks BookingItem.notes AND
 * emits a `booking_item.conflict_override` AuditLog row so dispatch
 * sees the conflict — not just the rep who approved it.
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import { getCategoryAvailability } from '@/lib/scheduling/availability'

type TxClient = PrismaClient | Prisma.TransactionClient

export interface ConflictingHold {
  bookingItemId: string
  bookingId: string
  bookingNumber: string
  jobName: string | null
  startDate: Date
  endDate: Date
  quantity: number
  status: string
  holdRank: number
}

/**
 * Identify OTHER bookings' holds against this category that overlap
 * the requested window. Excludes the calling order's own Booking by
 * id so a rep doesn't see their own truck as a "conflict."
 *
 * Returns the rows sorted by start date so the conflict UI shows the
 * earliest stepped-on booking first.
 */
export async function findConflictingHolds(
  tx: TxClient,
  args: {
    categoryId: string
    startDate: Date
    endDate: Date
    excludeBookingId: string
    /** When true, only REQUESTED + ASSIGNED count as conflicts.
     *  RETURNED/SWAPPED on BookingAssignment are terminal so they
     *  don't represent active commitments. */
    onlyActive?: boolean
  },
): Promise<ConflictingHold[]> {
  const onlyActive = args.onlyActive ?? true
  const rows = await tx.bookingItem.findMany({
    where: {
      categoryId: args.categoryId,
      // Only primary holds (rank 1) cause real conflicts. Backups
      // (rank ≥ 2) are explicitly allowed to overlap — same rule as
      // the holds endpoint.
      holdRank: 1,
      ...(onlyActive ? { status: { in: ['REQUESTED', 'ASSIGNED'] } } : {}),
      bookingId: { not: args.excludeBookingId },
      booking: {
        startDate: { lte: args.endDate },
        endDate: { gte: args.startDate },
      },
    },
    select: {
      id: true,
      bookingId: true,
      quantity: true,
      status: true,
      holdRank: true,
      booking: {
        select: {
          bookingNumber: true,
          jobName: true,
          startDate: true,
          endDate: true,
        },
      },
    },
    orderBy: { booking: { startDate: 'asc' } },
  })
  return rows.map((r) => ({
    bookingItemId: r.id,
    bookingId: r.bookingId,
    bookingNumber: r.booking.bookingNumber,
    jobName: r.booking.jobName,
    startDate: r.booking.startDate,
    endDate: r.booking.endDate,
    quantity: r.quantity,
    status: r.status,
    holdRank: r.holdRank,
  }))
}

/** What the availability + conflict checks return for an ADD/UPDATE
 *  proposal. The route handler turns this into a 409 with the
 *  structured payload when blocked, or proceeds when clear. */
export interface HoldCheckResult {
  /** True iff the delta qty fits within `availableToHold`. */
  capacityClear: boolean
  /** Specific OTHER bookings that overlap. Empty when no conflicts. */
  conflicts: ConflictingHold[]
  /** Underlying availability snapshot for the structured 409 payload. */
  availability: {
    serviceableCount: number
    freeCount: number
    bufferCount: number
    bookedCount: number
    availableToHold: number
  }
}

export async function checkHoldFeasibility(args: {
  tx: TxClient
  categoryId: string
  startDate: Date
  endDate: Date
  deltaQty: number
  excludeBookingId: string
}): Promise<HoldCheckResult> {
  const availability = await getCategoryAvailability(
    args.categoryId,
    args.startDate,
    args.endDate,
    1, // matches the default the holds endpoint uses
  )
  const capacityClear = args.deltaQty <= availability.availableToHold
  const conflicts = await findConflictingHolds(args.tx, {
    categoryId: args.categoryId,
    startDate: args.startDate,
    endDate: args.endDate,
    excludeBookingId: args.excludeBookingId,
  })
  return {
    capacityClear,
    conflicts,
    availability: {
      serviceableCount: availability.serviceableCount,
      freeCount: availability.freeCount,
      bufferCount: availability.bufferCount,
      bookedCount: availability.bookedCount,
      availableToHold: availability.availableToHold,
    },
  }
}

/**
 * Upsert the BookingItem for an Order's primary hold on this
 * category. Increments the running quantity by `addedQty`. Called
 * AFTER the caller's availability check has either cleared or the
 * rep confirmed the conflict override.
 *
 * Returns the resulting BookingItem id + the qty before/after so the
 * caller can include the diff in the AuditLog.
 */
export async function syncHoldOnLineAdd(
  tx: TxClient,
  args: {
    bookingId: string
    categoryId: string
    addedQty: number
    /** When the rep confirmed a conflict, the warning message gets
     *  stamped on BookingItem.notes so dispatch sees the override on
     *  the booking-detail page (not just in the AuditLog). */
    conflictOverrideNote?: string | null
  },
): Promise<{ bookingItemId: string; quantityBefore: number; quantityAfter: number; created: boolean }> {
  const existing = await tx.bookingItem.findFirst({
    where: { bookingId: args.bookingId, categoryId: args.categoryId, holdRank: 1 },
    select: { id: true, quantity: true, notes: true },
  })

  if (existing) {
    const next = existing.quantity + args.addedQty
    const notes = args.conflictOverrideNote
      ? appendNote(existing.notes, args.conflictOverrideNote)
      : existing.notes
    await tx.bookingItem.update({
      where: { id: existing.id },
      data: { quantity: next, notes },
    })
    return {
      bookingItemId: existing.id,
      quantityBefore: existing.quantity,
      quantityAfter: next,
      created: false,
    }
  }

  // No existing hold for this category — create at rank 1, status
  // REQUESTED, snapshot the category dailyRate. Mirrors holds/route.ts:273.
  const category = await tx.assetCategory.findUnique({
    where: { id: args.categoryId },
    select: { dailyRate: true },
  })
  if (!category) {
    throw new Error(`assetCategory ${args.categoryId} not found`)
  }
  const created = await tx.bookingItem.create({
    data: {
      bookingId: args.bookingId,
      categoryId: args.categoryId,
      quantity: args.addedQty,
      dailyRate: category.dailyRate,
      status: 'REQUESTED',
      holdRank: 1,
      notes: args.conflictOverrideNote ?? null,
    },
    select: { id: true },
  })
  return {
    bookingItemId: created.id,
    quantityBefore: 0,
    quantityAfter: args.addedQty,
    created: true,
  }
}

/**
 * Adjust the BookingItem quantity by a delta (positive grows, negative
 * shrinks). When the new quantity hits 0 the row is deleted entirely
 * — same end-state as `syncHoldOnLineDelete` for a one-qty line.
 *
 * The caller's availability check should have run with the SAME delta
 * before invoking this helper, so the conflict-override path stays
 * symmetric.
 */
export async function syncHoldOnLineUpdate(
  tx: TxClient,
  args: {
    bookingId: string
    categoryId: string
    deltaQty: number
    conflictOverrideNote?: string | null
  },
): Promise<{ bookingItemId: string | null; quantityBefore: number; quantityAfter: number; deleted: boolean }> {
  if (args.deltaQty === 0) {
    const existing = await tx.bookingItem.findFirst({
      where: { bookingId: args.bookingId, categoryId: args.categoryId, holdRank: 1 },
      select: { id: true, quantity: true },
    })
    return {
      bookingItemId: existing?.id ?? null,
      quantityBefore: existing?.quantity ?? 0,
      quantityAfter: existing?.quantity ?? 0,
      deleted: false,
    }
  }

  const existing = await tx.bookingItem.findFirst({
    where: { bookingId: args.bookingId, categoryId: args.categoryId, holdRank: 1 },
    select: { id: true, quantity: true, notes: true },
  })
  if (!existing) {
    // No hold to adjust. For positive delta, treat as an add.
    if (args.deltaQty > 0) {
      const created = await syncHoldOnLineAdd(tx, {
        bookingId: args.bookingId,
        categoryId: args.categoryId,
        addedQty: args.deltaQty,
        conflictOverrideNote: args.conflictOverrideNote ?? null,
      })
      return {
        bookingItemId: created.bookingItemId,
        quantityBefore: 0,
        quantityAfter: created.quantityAfter,
        deleted: false,
      }
    }
    // Negative delta with no row — nothing to do.
    return { bookingItemId: null, quantityBefore: 0, quantityAfter: 0, deleted: false }
  }

  const next = existing.quantity + args.deltaQty
  if (next <= 0) {
    await tx.bookingItem.delete({ where: { id: existing.id } })
    return {
      bookingItemId: existing.id,
      quantityBefore: existing.quantity,
      quantityAfter: 0,
      deleted: true,
    }
  }
  const notes = args.conflictOverrideNote
    ? appendNote(existing.notes, args.conflictOverrideNote)
    : existing.notes
  await tx.bookingItem.update({
    where: { id: existing.id },
    data: { quantity: next, notes },
  })
  return {
    bookingItemId: existing.id,
    quantityBefore: existing.quantity,
    quantityAfter: next,
    deleted: false,
  }
}

/**
 * Decrement the BookingItem quantity by `removedQty`. When the new
 * quantity hits 0 the row is deleted entirely so the schedule view
 * doesn't show a phantom hold.
 */
export async function syncHoldOnLineDelete(
  tx: TxClient,
  args: { bookingId: string; categoryId: string; removedQty: number },
): Promise<{ bookingItemId: string | null; quantityBefore: number; quantityAfter: number; deleted: boolean }> {
  return syncHoldOnLineUpdate(tx, {
    bookingId: args.bookingId,
    categoryId: args.categoryId,
    deltaQty: -Math.abs(args.removedQty),
  })
}

/** Compose a single-line note on top of existing notes. Keeps
 *  override stamps separated and grep-able. */
function appendNote(existing: string | null, append: string): string {
  const stamp = `[${new Date().toISOString().slice(0, 16)}] ${append}`
  if (!existing) return stamp
  return `${existing}\n${stamp}`
}
