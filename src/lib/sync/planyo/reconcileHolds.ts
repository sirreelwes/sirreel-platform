/**
 * Writes the SyncEvent intents into the DB. Every write path:
 *   1. uses the scope guard (Planyo-origin Bookings only)
 *   2. carries `booking: { source: 'PLANYO_BACKFILL' }` on writes that touch
 *      BookingItem so the where-filter also enforces scope.
 *   3. updates Reservation mirror first, then derives BookingItem from it.
 *
 * Returns the resolved before/after detail plus, where applicable, the
 * booking_id / booking_item_id the event touched.
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import {
  laDateStartToUTC,
  laDateEndToUTC,
  laDateToDbDate,
} from './dateConvention'
import {
  planyoOriginBookingOrThrow,
  planyoOriginBookingItemOrThrow,
} from './scopeGuard'
import type { CrosswalkEntry } from './resourceCrosswalk'
import type { SyncEvent } from './reconcile'
import type { PlanyoLine } from './planyoClient'

export interface ApplyResult {
  bookingId: string | null
  bookingItemId: string | null
  detail: string
}

/**
 * CREATE: upsert Reservation row + ensure BookingItem(category, holdRank=1)
 * exists with incremented qty + expand parent Booking envelope if the new
 * line falls outside the current envelope.
 */
export async function applyCreate(
  prisma: PrismaClient,
  planyo: PlanyoLine,
  cat: CrosswalkEntry,
): Promise<ApplyResult> {
  const cart = String(planyo.cart_id ?? '')
  const rid = String(planyo.reservation_id)
  const startLA = (planyo.start_time ?? '').slice(0, 10)
  const endLA = (planyo.end_time ?? '').slice(0, 10)
  const startUTC = laDateStartToUTC(startLA)
  const endUTC = laDateEndToUTC(endLA)

  return prisma.$transaction(async (tx) => {
    // find parent Booking by cart_id; sync only touches PLANYO_BACKFILL.
    const parent = await tx.booking.findFirst({
      where: { planyoCartId: cart, source: 'PLANYO_BACKFILL' },
      select: { id: true, startDate: true, endDate: true },
    })
    if (!parent) {
      throw new Error(`applyCreate: no PLANYO_BACKFILL Booking for cart ${cart}`)
    }
    await planyoOriginBookingOrThrow(tx, parent.id)

    // 1. Reservation mirror upsert (full fidelity)
    await tx.reservation.upsert({
      where: { planyoReservationId: rid },
      create: {
        bookingId: parent.id,
        unitName: planyo.unit_assignment ?? planyo.name ?? '?',
        category: planyo.name ?? null,
        startTime: startUTC,
        endTime: endUTC,
        status: 'HOLD',
        source: 'PLANYO',
        planyoReservationId: rid,
        planyoCartId: cart,
        planyoCompany: planyo.properties?.Company_Name ?? null,
        planyoJobName: planyo.properties?.Job_Name ?? null,
        planyoAgent: planyo.properties?.SirReel_Agent ?? null,
        planyoCustomerName: `${planyo.first_name ?? ''} ${planyo.last_name ?? ''}`.trim() || null,
        planyoCustomerEmail: planyo.email ?? null,
        planyoCustomerPhone: planyo.phone ?? null,
        notes: planyo.user_notes ?? null,
      },
      update: {},
    })

    // 2. BookingItem hold: +1 qty on the (booking, category, rank=1) row,
    //    create if missing. Both paths require source=PLANYO_BACKFILL.
    const existingItem = await tx.bookingItem.findFirst({
      where: {
        bookingId: parent.id,
        categoryId: cat.id,
        holdRank: 1,
        booking: { source: 'PLANYO_BACKFILL' },
      },
      select: { id: true, quantity: true },
    })
    let bookingItemId: string
    if (existingItem) {
      await planyoOriginBookingItemOrThrow(tx, existingItem.id)
      await tx.bookingItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + 1 },
      })
      bookingItemId = existingItem.id
    } else {
      const created = await tx.bookingItem.create({
        data: {
          bookingId: parent.id,
          categoryId: cat.id,
          quantity: 1,
          dailyRate: cat.dailyRate,
          status: 'REQUESTED',
          holdRank: 1,
        },
        select: { id: true },
      })
      bookingItemId = created.id
    }

    // 3. Expand Booking envelope if necessary (UTC-midnight encoding
    //    for @db.Date — the HQ convention; LA timestamps would not
    //    round-trip cleanly through @db.Date truncation).
    const lineStartDb = laDateToDbDate(startLA)
    const lineEndDb = laDateToDbDate(endLA)
    const newStart = parent.startDate && parent.startDate <= lineStartDb ? parent.startDate : lineStartDb
    const newEnd = parent.endDate && parent.endDate >= lineEndDb ? parent.endDate : lineEndDb
    if (
      (parent.startDate?.getTime() ?? 0) !== newStart.getTime() ||
      (parent.endDate?.getTime() ?? 0) !== newEnd.getTime()
    ) {
      await tx.booking.update({
        where: { id: parent.id },
        data: { startDate: newStart, endDate: newEnd },
      })
    }

    return {
      bookingId: parent.id,
      bookingItemId,
      detail: `created Reservation + ${existingItem ? 'incremented' : 'created'} BookingItem (cat=${cat.name}, qty=${existingItem ? existingItem.quantity + 1 : 1}) envelope=${ymd(newStart)}→${ymd(newEnd)}`,
    }
  })
}

/**
 * UPDATE_DATES: update the Reservation row's startTime/endTime in place;
 * expand the parent Booking envelope if the new dates extend beyond it.
 * BookingItem.quantity is unaffected.
 */
export async function applyUpdateDates(
  prisma: PrismaClient,
  planyo: PlanyoLine,
  hqReservationRowId: string,
): Promise<ApplyResult> {
  const startLA = (planyo.start_time ?? '').slice(0, 10)
  const endLA = (planyo.end_time ?? '').slice(0, 10)
  const startUTC = laDateStartToUTC(startLA)
  const endUTC = laDateEndToUTC(endLA)

  return prisma.$transaction(async (tx) => {
    const r = await tx.reservation.findUnique({
      where: { id: hqReservationRowId },
      select: { id: true, bookingId: true, planyoReservationId: true },
    })
    if (!r) throw new Error(`applyUpdateDates: reservation ${hqReservationRowId} not found`)
    if (!r.bookingId) throw new Error(`applyUpdateDates: reservation ${hqReservationRowId} has no parent Booking`)
    await planyoOriginBookingOrThrow(tx, r.bookingId)

    await tx.reservation.update({
      where: { id: r.id },
      data: { startTime: startUTC, endTime: endUTC },
    })

    const parent = await tx.booking.findUnique({
      where: { id: r.bookingId },
      select: { startDate: true, endDate: true },
    })
    if (parent) {
      const lineStartDb = laDateToDbDate(startLA)
      const lineEndDb = laDateToDbDate(endLA)
      const newStart = parent.startDate && parent.startDate <= lineStartDb ? parent.startDate : lineStartDb
      const newEnd = parent.endDate && parent.endDate >= lineEndDb ? parent.endDate : lineEndDb
      if (
        (parent.startDate?.getTime() ?? 0) !== newStart.getTime() ||
        (parent.endDate?.getTime() ?? 0) !== newEnd.getTime()
      ) {
        await tx.booking.update({
          where: { id: r.bookingId },
          data: { startDate: newStart, endDate: newEnd },
        })
      }
    }

    return {
      bookingId: r.bookingId,
      bookingItemId: null,
      detail: `updated Reservation dates to ${startLA}→${endLA}; Booking envelope refreshed if needed`,
    }
  })
}

/**
 * RELEASE: Planyo status=2. Mark Reservation CANCELLED, decrement the
 * matching BookingItem qty by 1 (delete row at qty=0).
 */
export async function applyRelease(
  prisma: PrismaClient,
  planyo: PlanyoLine,
  hqReservationRowId: string,
  crosswalk: Map<number, CrosswalkEntry>,
): Promise<ApplyResult> {
  const resId = parseInt(String(planyo.resource_id ?? 0), 10)
  const cat = crosswalk.get(resId)

  return prisma.$transaction(async (tx) => {
    const r = await tx.reservation.findUnique({
      where: { id: hqReservationRowId },
      select: { id: true, bookingId: true, status: true },
    })
    if (!r) throw new Error(`applyRelease: reservation ${hqReservationRowId} not found`)
    if (!r.bookingId) throw new Error(`applyRelease: reservation ${hqReservationRowId} has no parent Booking`)
    await planyoOriginBookingOrThrow(tx, r.bookingId)

    await tx.reservation.update({
      where: { id: r.id },
      data: { status: 'CANCELLED' },
    })

    let bookingItemId: string | null = null
    if (cat) {
      const item = await tx.bookingItem.findFirst({
        where: {
          bookingId: r.bookingId,
          categoryId: cat.id,
          holdRank: 1,
          booking: { source: 'PLANYO_BACKFILL' },
        },
        select: { id: true, quantity: true },
      })
      if (item) {
        await planyoOriginBookingItemOrThrow(tx, item.id)
        if (item.quantity <= 1) {
          await tx.bookingItem.delete({ where: { id: item.id } })
        } else {
          await tx.bookingItem.update({
            where: { id: item.id },
            data: { quantity: item.quantity - 1 },
          })
        }
        bookingItemId = item.id
      }
    }

    return {
      bookingId: r.bookingId,
      bookingItemId,
      detail: 'Reservation CANCELLED; BookingItem qty decremented (or row deleted at 0)',
    }
  })
}

function ymd(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : '?'
}
