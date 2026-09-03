/**
 * Shared booking-assignment selection for "what moves today" — used by
 * BOTH the fleet-readiness cron digest and the /fleet/today mobile
 * board, so the two can never drift.
 *
 * Scope guards:
 *   - Booking status CONFIRMED/ACTIVE. PLANYO_BACKFILL rows are
 *     INCLUDED — since the 2026-08-18 import they ARE the live book,
 *     not a stale snapshot (the pre-import exclusion was removed
 *     2026-08-21 for the team rollout).
 *   - Assignment status depends on the edge. DEPARTURES are ASSIGNED
 *     only (CHECKED_OUT is already gone; RETURNED/SWAPPED are stale).
 *     RETURNS also include CHECKED_OUT and RETURNED — a unit checked in
 *     this morning has to stay on today's board as DONE rather than
 *     vanishing from it, or the crew loses the record of the work they
 *     just did and the board's remaining count is the only proof it
 *     ever appeared. SWAPPED stays excluded on both: that unit isn't on
 *     this booking any more.
 *
 * `edge` picks which side of the assignment matches the date:
 * 'start' → departures, 'end' → returns. Times come from the booking's
 * deliveryTime/pickupTime free-text fields.
 */

import { prisma } from '@/lib/prisma'
import { companyLabel } from '@/lib/scheduling/infoGaps'

/** YYYY-MM-DD in America/Los_Angeles, offset by N days. */
export function pacificYmd(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86_400_000))
}

/** BookingAssignment.startDate/endDate are @db.Date (UTC-midnight) — match on that. */
export const ymdToDbDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)

export interface FleetMovement {
  assignmentId: string
  /**
   * The Job this booking belongs to, when it has one. Added 2026-09-02
   * for the merged yard board, which groups trucks and pick lists under
   * one show — without it the two lanes can never recognise each other.
   * Nullable: bookings predating the Planyo import carry no jobId.
   */
  jobId: string | null
  unitName: string
  category: string
  bookingNumber: string
  jobName: string
  company: string
  /** booking.deliveryTime — relevant on the 'start' edge */
  deliveryTime: string | null
  /** booking.pickupTime — relevant on the 'end' edge */
  pickupTime: string | null
  /** The assignment's CHECKOUT (pre-rental) inspection, if submitted. */
  inspection: { id: string; inspectionDate: string; inspectorName: string | null } | null
  /** The assignment's RETURN inspection — the unit has been received. */
  returnInspection: { id: string; inspectionDate: string; inspectorName: string | null } | null
}

export async function fleetMovementsOn(dbDate: Date, edge: 'start' | 'end'): Promise<FleetMovement[]> {
  const rows = await prisma.bookingAssignment.findMany({
    where: {
      status: edge === 'start' ? 'ASSIGNED' : { in: ['ASSIGNED', 'CHECKED_OUT', 'RETURNED'] },
      ...(edge === 'start' ? { startDate: dbDate } : { endDate: dbDate }),
      bookingItem: {
        booking: {
          status: { in: ['CONFIRMED', 'ACTIVE'] },
        },
      },
    },
    select: {
      id: true,
      asset: { select: { unitName: true } },
      bookingItem: {
        select: {
          category: { select: { name: true } },
          booking: {
            select: {
              bookingNumber: true,
              jobId: true,
              jobName: true,
              deliveryTime: true,
              pickupTime: true,
              company: { select: { name: true } },
            },
          },
        },
      },
      // Both edges of the vehicle's arc. The checkout drives the
      // departure card; the return drives the arrival card, which
      // could not exist before /fleet/return did.
      inspections: {
        where: { type: { in: ['CHECKOUT', 'RETURN'] } },
        select: {
          id: true,
          type: true,
          inspectionDate: true,
          inspectedByUser: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })
  const shape = (i: { id: string; inspectionDate: Date; inspectedByUser: { name: string | null } } | undefined) =>
    i
      ? {
          id: i.id,
          inspectionDate: i.inspectionDate.toISOString(),
          inspectorName: i.inspectedByUser?.name ?? null,
        }
      : null

  return rows.map((r) => {
    const insp = r.inspections.find((i) => i.type === 'CHECKOUT')
    const ret = r.inspections.find((i) => i.type === 'RETURN')
    return {
      assignmentId: r.id,
      jobId: r.bookingItem.booking.jobId,
      unitName: r.asset.unitName,
      category: r.bookingItem.category.name,
      bookingNumber: r.bookingItem.booking.bookingNumber,
      jobName: r.bookingItem.booking.jobName,
      company: companyLabel(r.bookingItem.booking.company?.name),
      deliveryTime: r.bookingItem.booking.deliveryTime,
      pickupTime: r.bookingItem.booking.pickupTime,
      inspection: shape(insp),
      returnInspection: shape(ret),
    }
  })
}
