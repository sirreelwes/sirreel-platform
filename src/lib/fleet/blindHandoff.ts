/**
 * Is THIS vehicle's handoff blind? — the one answer for everything that
 * hands a driver photo steps or a lockbox code, paints a bar violet, or
 * shows a toggle.
 *
 * Wes 2026-09-16: "All drivers are being prompted to do the damage ID-style
 * photos when we only want that … when it is a blind pickup or a blind
 * return", and "we do not distribute the key lockbox code except on blind
 * handoffs."
 *
 * Jose 2026-09-16: "we only have the option of making the entire order
 * blind. Sometimes jobs have multiple vehicles and we need the ability to
 * only mark certain vehicles as blind pickups or returns."
 *
 * Two layers, one reader:
 *
 *   ORDER  — Order.blindPickup / blindReturn is the job-wide default. It
 *            is what the client portal instructions and the closed-day
 *            prompt key on, and what a job with no unit assigned yet has.
 *            Which orders speak for a vehicle is decided by its BOOKING:
 *              1. Orders bound to the vehicle's booking decide it.
 *              2. With none bound, the job's UNBOUND orders decide it — no
 *                 bookingId, or one pointing at a booking that is no
 *                 longer live (a rebook leaves the order on its cancelled
 *                 twin; SR-JOB-0311 did exactly that).
 *              3. An order bound to a DIFFERENT live booking never speaks
 *                 for this one.
 *
 *   VEHICLE — BookingAssignment.blindPickup / blindReturn overrides the
 *            order for that unit alone. NULL follows the order. Written
 *            only through POST /api/jobs/[id]/blind-handoff, whose
 *            job-wide toggle resets every override so "whole job blind"
 *            means it.
 *
 * Before the override existed, marking one van blind made every driver on
 * the job a blind pickup (photo check-out AND the lockbox code) — Wrong
 * Number, SR-JOB-0273. Any NEW surface that shows Asset.accessCode to a
 * driver or client, or offers the self check-out, goes through
 * `blindForVehicle` / `blindHandoffForAssignment`.
 */

import { prisma } from '@/lib/prisma'
import { blindFlags, blindForVehicle, ordersForBooking, type BlindFlags, type BlindOverrideLike } from './blindRule'

// The pure rule lives in ./blindRule (no prisma — client components import it).
export * from './blindRule'

/** The job's live orders and live booking ids — what `ordersForBooking` needs. */
export async function loadJobBlindContext(jobId: string) {
  const [orders, bookings] = await Promise.all([
    prisma.order.findMany({
      where: { jobId, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        bookingId: true,
        blindPickup: true,
        blindReturn: true,
        blindPickupInstructions: true,
        blindReturnInstructions: true,
      },
    }),
    prisma.booking.findMany({
      where: { jobId, status: { notIn: ['CANCELLED', 'ARCHIVED'] }, archivedAt: null },
      select: { id: true },
    }),
  ])
  return { orders, liveBookingIds: new Set(bookings.map((b) => b.id)) }
}

/**
 * Blind flags for one vehicle's booking, order layer only — for callers
 * that have a booking but no particular unit (nothing driver-facing
 * should be one of them; those use `blindHandoffForAssignment`).
 */
export async function blindHandoffForBooking(booking: { id: string; jobId: string | null }): Promise<BlindFlags> {
  if (!booking.jobId) return { blindPickup: false, blindReturn: false, any: false }
  const ctx = await loadJobBlindContext(booking.jobId)
  return blindFlags(ordersForBooking(ctx.orders, booking.id, ctx.liveBookingIds))
}

/** The effective blind flags for one assignment (unit + window), straight from the database. */
export async function blindHandoffForAssignment(assignmentId: string): Promise<BlindFlags> {
  const a = await prisma.bookingAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      blindPickup: true,
      blindReturn: true,
      bookingItem: { select: { booking: { select: { id: true, jobId: true } } } },
    },
  })
  if (!a || !a.bookingItem.booking.jobId) return { blindPickup: false, blindReturn: false, any: false }
  const ctx = await loadJobBlindContext(a.bookingItem.booking.jobId)
  return blindForVehicle(ordersForBooking(ctx.orders, a.bookingItem.booking.id, ctx.liveBookingIds), a)
}

/** One vehicle on the job, as the toggles and the board need to see it. */
export interface BlindVehicle {
  assignmentId: string
  unitName: string
  category: string
  bookingId: string
  bookingNumber: string
  startDate: string
  endDate: string
  /** Stored override — null follows the order. */
  blindPickup: boolean | null
  blindReturn: boolean | null
  /** What actually happens for this unit. */
  effective: { blindPickup: boolean; blindReturn: boolean }
}

export interface JobBlindState {
  orders: Array<{ id: string; orderNumber: string; status: string; blindPickup: boolean; blindReturn: boolean }>
  vehicles: BlindVehicle[]
}

/**
 * Everything blind about a job: its live orders and every live vehicle
 * with its effective answer. Feeds GET/POST /api/jobs/[id]/blind-handoff
 * and the surfaces that list vehicles.
 */
export async function loadJobBlindState(jobId: string): Promise<JobBlindState> {
  const [ctx, assignments] = await Promise.all([
    loadJobBlindContext(jobId),
    prisma.bookingAssignment.findMany({
      where: {
        status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
        bookingItem: { booking: { jobId, status: { notIn: ['CANCELLED', 'ARCHIVED'] }, archivedAt: null } },
      },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        startDate: true,
        endDate: true,
        blindPickup: true,
        blindReturn: true,
        asset: { select: { unitName: true, category: { select: { name: true } } } },
        bookingItem: { select: { booking: { select: { id: true, bookingNumber: true } } } },
      },
    }),
  ])
  return {
    orders: ctx.orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      blindPickup: o.blindPickup,
      blindReturn: o.blindReturn,
    })),
    vehicles: assignments.map((a) => {
      const eff = blindForVehicle(ordersForBooking(ctx.orders, a.bookingItem.booking.id, ctx.liveBookingIds), a)
      return {
        assignmentId: a.id,
        unitName: a.asset.unitName,
        category: a.asset.category?.name ?? '',
        bookingId: a.bookingItem.booking.id,
        bookingNumber: a.bookingItem.booking.bookingNumber,
        startDate: a.startDate.toISOString().slice(0, 10),
        endDate: a.endDate.toISOString().slice(0, 10),
        blindPickup: a.blindPickup,
        blindReturn: a.blindReturn,
        effective: { blindPickup: eff.blindPickup, blindReturn: eff.blindReturn },
      }
    }),
  }
}

/** Live vehicle overrides on a job, for callers that only hold the job id. */
export async function loadJobVehicleOverrides(jobId: string): Promise<BlindOverrideLike[]> {
  return prisma.bookingAssignment.findMany({
    where: {
      status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
      OR: [{ blindPickup: { not: null } }, { blindReturn: { not: null } }],
      bookingItem: { booking: { jobId, status: { notIn: ['CANCELLED', 'ARCHIVED'] }, archivedAt: null } },
    },
    select: { blindPickup: true, blindReturn: true },
  })
}
