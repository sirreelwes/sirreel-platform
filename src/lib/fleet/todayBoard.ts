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

/** Pacific-day and window helpers live in a prisma-free module so they
 *  can be tested without a database; re-exported here because every
 *  caller of this one has always got them from it. */
export { pacificYmd, ymdToDbDate, checkWindowYmds } from '@/lib/fleet/checkWindow'

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
  /**
   * The order sales said THIS unit is going out on (Hugo, 2026-09-03).
   * Null on every historical row and wherever sales hasn't named a unit
   * — the yard board treats it as extra information, never a blocker.
   */
  attachedOrder: { id: string; orderNumber: string } | null
  /**
   * The job's LIVE orders with their blind-handoff flags (Julian,
   * 2026-09-15: three vans going out blind and the check list had no way
   * to say so, or to mark it). A unit is blind when ANY live order on the
   * job says so — the same rule the reservations board paints violet.
   */
  liveOrders: Array<{ id: string; orderNumber: string; status: string; blindPickup: boolean; blindReturn: boolean }>
  /**
   * The calendar day THIS edge falls on, as YYYY-MM-DD. Same value the
   * caller matched on, carried back on the row so a multi-day read can
   * group without asking one day at a time.
   */
  edgeDate: string
  /** The assignment's CHECKOUT (pre-rental) inspection, if submitted. */
  inspection: { id: string; inspectionDate: string; inspectorName: string | null } | null
  /** The assignment's RETURN inspection — the unit has been received. */
  returnInspection: { id: string; inspectionDate: string; inspectorName: string | null } | null
}

/** One day of movements. The single-day read every caller had before the
 *  range read existed; still exactly a range of one. */
export async function fleetMovementsOn(dbDate: Date, edge: 'start' | 'end'): Promise<FleetMovement[]> {
  return fleetMovementsBetween(dbDate, dbDate, edge)
}

/**
 * Movements whose edge falls anywhere in [from, to] INCLUSIVE.
 *
 * Same selection and same shape as the single-day read — deliberately,
 * because the whole point of this module is that the cron, the yard
 * board and the check lists cannot disagree about what is moving. A
 * caller wanting a window used to loop this once per day; the rows carry
 * `edgeDate` so it can ask once and group.
 */
export async function fleetMovementsBetween(
  fromDbDate: Date,
  toDbDate: Date,
  edge: 'start' | 'end',
): Promise<FleetMovement[]> {
  const range = { gte: fromDbDate, lte: toDbDate }
  const rows = await prisma.bookingAssignment.findMany({
    where: {
      status: edge === 'start' ? 'ASSIGNED' : { in: ['ASSIGNED', 'CHECKED_OUT', 'RETURNED'] },
      ...(edge === 'start' ? { startDate: range } : { endDate: range }),
      bookingItem: {
        booking: {
          status: { in: ['CONFIRMED', 'ACTIVE'] },
        },
      },
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      order: { select: { id: true, orderNumber: true, status: true } },
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
              job: {
                select: {
                  orders: {
                    where: { status: { not: 'CANCELLED' } },
                    select: { id: true, orderNumber: true, status: true, blindPickup: true, blindReturn: true },
                    orderBy: { createdAt: 'asc' },
                  },
                },
              },
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
          inspectorName: true,
          inspectedByUser: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })
  const shape = (i: { id: string; inspectionDate: Date; inspectorName: string | null; inspectedByUser: { name: string | null } | null } | undefined) =>
    i
      ? {
          id: i.id,
          inspectionDate: i.inspectionDate.toISOString(),
          // The picked name, not the login — fleet@ is shared.
          inspectorName: i.inspectorName ?? i.inspectedByUser?.name ?? null,
        }
      : null

  return rows.map((r) => {
    const insp = r.inspections.find((i) => i.type === 'CHECKOUT')
    const ret = r.inspections.find((i) => i.type === 'RETURN')
    return {
      assignmentId: r.id,
      jobId: r.bookingItem.booking.jobId,
      // @db.Date is UTC midnight — sliced in UTC, never Pacific, or every
      // afternoon reads the row onto the day before (see calendarDayOf).
      edgeDate: (edge === 'start' ? r.startDate : r.endDate).toISOString().slice(0, 10),
      unitName: r.asset.unitName,
      category: r.bookingItem.category.name,
      bookingNumber: r.bookingItem.booking.bookingNumber,
      jobName: r.bookingItem.booking.jobName,
      company: companyLabel(r.bookingItem.booking.company?.name),
      deliveryTime: r.bookingItem.booking.deliveryTime,
      pickupTime: r.bookingItem.booking.pickupTime,
      attachedOrder: attachedOrderOf(r.order, r.bookingItem.booking.job?.orders ?? []),
      liveOrders: r.bookingItem.booking.job?.orders ?? [],
      inspection: shape(insp),
      returnInspection: shape(ret),
    }
  })
}

/**
 * The order a unit goes out on. A unit attached to an order that was
 * since CANCELLED (a rebook writes a new order; the assignment keeps
 * pointing at the dead one) reads as the job's single live order instead
 * — Wrong Number's three vans showed "Order attached · S260915-004", a
 * cancelled order, while S260915-005 was the real one. With several live
 * orders there is no honest pick, so it shows none rather than guess.
 */
function attachedOrderOf(
  order: { id: string; orderNumber: string; status: string } | null,
  liveOrders: Array<{ id: string; orderNumber: string }>,
): { id: string; orderNumber: string } | null {
  if (!order) return null
  if (order.status !== 'CANCELLED') return { id: order.id, orderNumber: order.orderNumber }
  return liveOrders.length === 1 ? { id: liveOrders[0].id, orderNumber: liveOrders[0].orderNumber } : null
}
