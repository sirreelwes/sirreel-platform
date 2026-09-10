/**
 * Record, on the HQ Reservation, that Planyo has confirmed the
 * reservation cancelled AND that HQ has stopped holding the capacity.
 *
 * ── Why this exists ──────────────────────────────────────────────────
 * `releaseBookingItem` is the one place a hold comes down, and it works
 * on the BookingItem / BookingAssignment rows — the CAPACITY side. It
 * deliberately knows nothing about Planyo. But the daily sync decides
 * whether to re-flag a row by reading `Reservation.status`:
 *
 *     where: { source: 'PLANYO', status: { not: 'CANCELLED' }, ... }
 *
 * so a hold released through EITHER path — the /planyo-cancellations
 * button or the auto-release cron — left its Reservation at HOLD and got
 * re-probed the next morning, found still-cancelled in Planyo, and
 * re-emitted as a RELEASE_CANDIDATE. Forever.
 *
 * Measured 2026-09-10: 37 of the day's 53 candidates were rows whose
 * BookingItem was ALREADY UNFULFILLED — released by hand, re-flagged
 * every day since. Because `autoReleaseCandidates` compared the RAW
 * candidate count against its cap of 15, that permanent backlog kept the
 * circuit breaker tripped every single night, so the cron released
 * nothing at all and the genuinely-cancelled trucks stayed on the board.
 * Clearing candidates by hand made it strictly worse: every manual
 * release added another zombie.
 *
 * Stamping CANCELLED is HQ recording a fact it has confirmed twice —
 * Planyo says cancelled, and the unit is no longer held. It frees no
 * capacity on its own; the release already did that.
 *
 * ── The trade-off it inherits ────────────────────────────────────────
 * A CANCELLED Reservation is never re-probed, so a Planyo REINSTATEMENT
 * of a settled row goes unnoticed (the under-hold / double-book
 * direction). That exposure is not new — it is the same one runSync's
 * `status: { not: 'CANCELLED' }` filter already carries, and the
 * REINSTATE_CANDIDATE follow-on filed in runSync.ts is where it gets
 * closed. This helper just makes the filter actually engage for rows
 * that were released rather than only ones the RELEASE op deleted.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma, PrismaClient } from '@prisma/client'

type Tx = Prisma.TransactionClient | PrismaClient

export interface SettleResult {
  /** True when this call moved the row HOLD/CONFIRMED → CANCELLED. */
  settled: boolean
  /** True when it was already CANCELLED — idempotent no-op. */
  alreadySettled: boolean
  reason?: string
}

/**
 * Stamp one Planyo-origin Reservation CANCELLED.
 *
 * Scope-guarded the same way every other write in this sync is: the row
 * must be `source: 'PLANYO'` and carry the reservation id we matched on.
 * Anything else is refused rather than written — an HQ-native
 * reservation must never be closed by a Planyo code path.
 */
export async function settlePlanyoCancellation(
  planyoReservationId: string,
  tx: Tx = prisma,
): Promise<SettleResult> {
  const r = await tx.reservation.findUnique({
    where: { planyoReservationId },
    select: { id: true, status: true, source: true },
  })
  if (!r) return { settled: false, alreadySettled: false, reason: 'reservation not found' }
  if (r.source !== 'PLANYO') {
    return {
      settled: false,
      alreadySettled: false,
      reason: `SCOPE_GUARD: reservation ${r.id} is source=${r.source}, not PLANYO`,
    }
  }
  if (r.status === 'CANCELLED') return { settled: false, alreadySettled: true }

  await tx.reservation.update({ where: { id: r.id }, data: { status: 'CANCELLED' } })
  return { settled: true, alreadySettled: false }
}
