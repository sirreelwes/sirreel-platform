/**
 * Pure diff layer. No I/O. Given the fresh Planyo lines, the in-scope HQ
 * Reservation rows, and the resource crosswalk, return an ordered list of
 * SyncEvent intents. The orchestrator (runSync) translates intents into
 * DB writes via reconcileHolds.
 */

import {
  planyoLocalTimeToLADate,
  hqStoredToLADate,
  readHQDateLA,
} from './dateConvention'
import type { CrosswalkEntry } from './resourceCrosswalk'
import type { PlanyoLine } from './planyoClient'

export type SyncOp =
  | 'CREATE'
  | 'UPDATE_DATES'
  | 'UPDATE_QTY'
  | 'UPDATE_STATUS'
  | 'RELEASE'
  | 'RELEASE_CANDIDATE'
  | 'FLAG_UNMAPPED'
  | 'LOG_CONFLICT'
  | 'AMBIGUOUS_ABSENT'
  | 'NO_CHANGE'
  | 'SKIP_CANCELLED_NEW'

export interface HQReservationSnapshot {
  id: string
  planyoReservationId: string
  planyoCartId: string | null
  unitName: string
  startTime: Date
  endTime: Date
  bookingId: string | null
}

export interface SyncEvent {
  op: SyncOp
  planyoReservationId: string
  planyoCartId: string
  detail: string
  // Fully-resolved before/after snapshots for the event log
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

/**
 * Planyo resource IDs that aren't rentals (e.g. internal "Task List"
 * placeholders the team uses on Planyo for non-fleet work). Lines on
 * these resources are skipped as NO_CHANGE so they don't pollute the
 * `unmapped` baseline — a genuinely-new unmapped resource later is a
 * real signal that should stand out, not noise.
 */
export const IGNORED_PLANYO_RESOURCE_IDS: ReadonlySet<number> = new Set<number>([
  132989, // "Task List"
])

/** @deprecated The `status` field is NOT the cancellation signal on this
 *  Planyo site. A cancelled reservation typically retains its
 *  pre-cancel status (often 11 = "arrived/confirmed"). Confirmed by
 *  the LOTUMN belt-test 2026-06-18 against resv 19710795. Use
 *  `isReservationCancelled` instead.
 */
export function isCancelledStatus(code: unknown): boolean {
  return parseInt(String(code), 10) === 2
}

/**
 * Detect CURRENT cancellation on a Planyo reservation.
 *
 * Why not `log_events`: a `event === '2'` entry in `log_events`
 * indicates a HISTORICAL cancellation but does NOT prove the
 * reservation is currently cancelled. A cancelled reservation can be
 * reinstated; the '2' event stays in the log forever. Verified on
 * resv 19646614 — has `event === '2'` in log_events but is currently
 * confirmed.
 *
 * Why `user_text`: this is Planyo's system-rendered current-state
 * message. For cancelled reservations it carries
 *   "This reservation has been cancelled by the administrator."
 * (or a "by the customer" variant for self-service cancels). For
 * active reservations it carries some "confirmed" / "now confirmed"
 * variant. The field is auto-rendered from current state — when a
 * cancelled reservation is reinstated, the field flips back. This is
 * the only field we found that reflects current state monotonically.
 *
 * NOTE: `list_reservations` (even at detail_level=5) does NOT include
 * `user_text` or `log_events`. Detection requires a per-reservation
 * `get_reservation_data` call. Also, cancelled reservations are
 * removed from `list_reservations` results entirely (verified on
 * 19710795 post-cancel) — so a candidate set is:
 *   (HQ reservations on PLANYO_BACKFILL bookings) ∩ (not in pull) ∪ (any
 *    reservation in the pull whose user_text fetched separately says
 *    cancelled). Cron policy is downstream of this helper.
 */
export function isReservationCancelled(
  line: { user_text?: string | null | undefined } | undefined | null,
): boolean {
  const t = line?.user_text ?? ''
  return /cancel{1,2}ed/i.test(t)
}

/** Reconcile one Planyo line + (optional) matching HQ row. */
export function diffLine(
  planyo: PlanyoLine,
  hq: HQReservationSnapshot | undefined,
  crosswalk: Map<number, CrosswalkEntry>,
): SyncEvent {
  const rid = String(planyo.reservation_id)
  const cart = String(planyo.cart_id ?? '')
  const resId = parseInt(String(planyo.resource_id ?? 0), 10)
  const cat = crosswalk.get(resId)

  if (!cat) {
    if (IGNORED_PLANYO_RESOURCE_IDS.has(resId)) {
      return {
        op: 'NO_CHANGE',
        planyoReservationId: rid,
        planyoCartId: cart,
        detail: `non-rental Planyo resource (resource_id=${resId}, name=${planyo.name ?? '?'}) — silently skipped`,
      }
    }
    return {
      op: 'FLAG_UNMAPPED',
      planyoReservationId: rid,
      planyoCartId: cart,
      detail: `planyo_resource_id=${resId} has no AssetCategory crosswalk (resource_name=${planyo.name ?? '?'})`,
      before: hq ? snapshot(hq) : undefined,
      after: { planyoResourceId: resId, planyoResourceName: planyo.name },
    }
  }

  const planyoStart = planyoLocalTimeToLADate(planyo.start_time)
  const planyoEnd = planyoLocalTimeToLADate(planyo.end_time)
  if (!planyoStart || !planyoEnd) {
    return {
      op: 'FLAG_UNMAPPED',
      planyoReservationId: rid,
      planyoCartId: cart,
      detail: 'unparseable start_time/end_time',
      before: hq ? snapshot(hq) : undefined,
      after: { startTime: planyo.start_time, endTime: planyo.end_time },
    }
  }

  if (!hq) {
    // No HQ row. Emit CREATE candidate; the orchestrator's CREATE-probe
    // pass calls `get_reservation_data` and checks `user_text` via
    // `isReservationCancelled`, demoting to SKIP_CANCELLED_NEW if the
    // line is already cancelled in Planyo. The bulk pull does not carry
    // user_text or log_events at any detail_level, and the `status`
    // field is the dead canary (verified 2026-06-18 on LOTUMN +
    // Concrete cancellations both held status=11), so a synchronous
    // check at the diff layer is impossible.
    return {
      op: 'CREATE',
      planyoReservationId: rid,
      planyoCartId: cart,
      detail: `${cat.name} "${planyo.unit_assignment ?? ''}" ${planyoStart}→${planyoEnd} status=${planyo.status} rate=$${cat.dailyRate}`,
      after: {
        startLA: planyoStart,
        endLA: planyoEnd,
        categoryId: cat.id,
        categoryName: cat.name,
        unitName: planyo.unit_assignment ?? null,
        status: planyo.status,
        planyoCompany: planyo.properties?.Company_Name ?? null,
        planyoJobName: planyo.properties?.Job_Name ?? null,
        planyoAgent: planyo.properties?.SirReel_Agent ?? null,
        planyoCustomerName: `${planyo.first_name ?? ''} ${planyo.last_name ?? ''}`.trim() || null,
        planyoCustomerEmail: planyo.email ?? null,
        planyoCustomerPhone: planyo.phone ?? null,
        userNotes: planyo.user_notes ?? null,
      },
    }
  }

  // HQ row exists.
  if (isCancelledStatus(planyo.status)) {
    return {
      op: 'RELEASE',
      planyoReservationId: rid,
      planyoCartId: cart,
      detail: 'Planyo status=2 cancelled — release BookingItem hold',
      before: snapshot(hq),
      after: { status: 'CANCELLED' },
    }
  }

  // Convention-aware: 00:00:00 UTC → Convention B (UTC components);
  // any other time-of-day → Convention A (LA-render). Deterministic.
  const hqStart = readHQDateLA(hq.startTime)
  const hqEnd = readHQDateLA(hq.endTime)
  if (hqStart !== planyoStart || hqEnd !== planyoEnd) {
    return {
      op: 'UPDATE_DATES',
      planyoReservationId: rid,
      planyoCartId: cart,
      detail: `HQ ${hqStart}→${hqEnd}  vs  Planyo ${planyoStart}→${planyoEnd}`,
      before: { startLA: hqStart, endLA: hqEnd },
      after: { startLA: planyoStart, endLA: planyoEnd },
    }
  }

  return {
    op: 'NO_CHANGE',
    planyoReservationId: rid,
    planyoCartId: cart,
    detail: 'dates align (LA canonical)',
  }
}

function snapshot(hq: HQReservationSnapshot): Record<string, unknown> {
  return {
    reservationRowId: hq.id,
    startLA: readHQDateLA(hq.startTime),
    endLA: readHQDateLA(hq.endTime),
    unitName: hq.unitName,
    bookingId: hq.bookingId,
  }
}
