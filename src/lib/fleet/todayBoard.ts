/**
 * Shared booking-assignment selection for "what moves today" — used by
 * BOTH the fleet-readiness cron digest and the /fleet/today mobile
 * board, so the two can never drift.
 *
 * Scope guards (same as the cron always had):
 *   - Booking status CONFIRMED/ACTIVE, source != PLANYO_BACKFILL (the
 *     backfill rows are a stale prior-import snapshot, not live
 *     commitments — CLAUDE.md).
 *   - Assignment status ASSIGNED only (CHECKED_OUT is already gone;
 *     RETURNED/SWAPPED are stale).
 *
 * `edge` picks which side of the assignment matches the date:
 * 'start' → departures, 'end' → returns. Times come from the booking's
 * deliveryTime/pickupTime free-text fields.
 */

import { prisma } from '@/lib/prisma'

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
}

export async function fleetMovementsOn(dbDate: Date, edge: 'start' | 'end'): Promise<FleetMovement[]> {
  const rows = await prisma.bookingAssignment.findMany({
    where: {
      status: 'ASSIGNED',
      ...(edge === 'start' ? { startDate: dbDate } : { endDate: dbDate }),
      bookingItem: {
        booking: {
          status: { in: ['CONFIRMED', 'ACTIVE'] },
          source: { not: 'PLANYO_BACKFILL' },
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
              jobName: true,
              deliveryTime: true,
              pickupTime: true,
              company: { select: { name: true } },
            },
          },
        },
      },
      inspections: {
        where: { type: 'CHECKOUT' },
        select: {
          id: true,
          inspectionDate: true,
          inspectedByUser: { select: { name: true } },
        },
        take: 1,
      },
    },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map((r) => {
    const insp = r.inspections[0] ?? null
    return {
      assignmentId: r.id,
      unitName: r.asset.unitName,
      category: r.bookingItem.category.name,
      bookingNumber: r.bookingItem.booking.bookingNumber,
      jobName: r.bookingItem.booking.jobName,
      company: r.bookingItem.booking.company.name,
      deliveryTime: r.bookingItem.booking.deliveryTime,
      pickupTime: r.bookingItem.booking.pickupTime,
      inspection: insp
        ? {
            id: insp.id,
            inspectionDate: insp.inspectionDate.toISOString(),
            inspectorName: insp.inspectedByUser?.name ?? null,
          }
        : null,
    }
  })
}
