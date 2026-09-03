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
import {
  resolvePlanyoUnitName,
  PLANYO_UNIT_CATEGORY_OVERRIDES,
} from '@/lib/scheduling/planyoNameNormalizer'

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
      // An ADOPTED cart lives on a NATIVE booking (adoptNativeBooking.ts):
      // the cart id is stamped on it, but source stays native so scopeGuard
      // keeps the sync out of a booking a human owns. That is a deliberate
      // state, not a fault — report it as skipped rather than throwing and
      // failing the whole run.
      const adopted = await tx.booking.findFirst({
        where: { planyoCartId: cart },
        select: { id: true, bookingNumber: true, source: true },
      })
      if (adopted) {
        return {
          bookingId: adopted.id,
          bookingItemId: null,
          detail: `SKIPPED_ADOPTED_NATIVE cart=${cart} booking=${adopted.bookingNumber} — HQ owns this rental; Planyo edits are not applied to it`,
        }
      }
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
      select: { id: true, bookingId: true, planyoReservationId: true, unitName: true, category: true },
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

    // The BookingAssignment window used to be left behind here — this
    // function moved the mirror and the Booking envelope, but the
    // assignment kept whatever dates it was created with at import.
    // A stale window is not inert: it holds the asset across days the
    // rental doesn't cover, which reads as a conflict on /gantt and
    // blocks a legitimate reassignment onto that unit. Same ruling as
    // UPDATE_UNIT (Wes 2026-09-02) — Planyo wins.
    //
    // Only the assignment on the unit this line names is touched, and
    // only when the new window is free; a CHECKED_OUT truck is left
    // alone. Nothing here can move an assignment to a different asset.
    let asgDetail = ''
    const staleUnit = resolvePlanyoUnitName(r.unitName ?? '', r.category ?? '').lookupName
    const asg = await tx.bookingAssignment.findFirst({
      where: {
        bookingItem: { bookingId: r.bookingId, booking: { source: 'PLANYO_BACKFILL' } },
        asset: { unitName: staleUnit },
        status: 'ASSIGNED',
      },
      select: { id: true, assetId: true, startDate: true, endDate: true, bookingItemId: true },
    })
    if (asg) {
      const newStart = laDateToDbDate(startLA)
      const newEnd = laDateToDbDate(endLA)
      if (+asg.startDate !== +newStart || +asg.endDate !== +newEnd) {
        const blocking = await tx.bookingAssignment.findFirst({
          where: {
            assetId: asg.assetId,
            id: { not: asg.id },
            status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
            startDate: { lte: newEnd },
            endDate: { gte: newStart },
          },
          select: { bookingItem: { select: { booking: { select: { bookingNumber: true } } } } },
        })
        if (blocking) {
          asgDetail = `; assignment window LEFT STALE — ${startLA}→${endLA} on ${staleUnit} collides with ${blocking.bookingItem.booking.bookingNumber}`
        } else {
          await planyoOriginBookingItemOrThrow(tx, asg.bookingItemId)
          await tx.bookingAssignment.update({
            where: { id: asg.id },
            data: { startDate: newStart, endDate: newEnd },
          })
          asgDetail = `; assignment window on ${staleUnit} moved to ${startLA}→${endLA}`
        }
      }
    }

    return {
      bookingId: r.bookingId,
      bookingItemId: asg?.bookingItemId ?? null,
      detail: `updated Reservation dates to ${startLA}→${endLA}; Booking envelope refreshed if needed${asgDetail}`,
    }
  })
}

/**
 * UPDATE_UNIT: Planyo moved this line to a different unit.
 *
 * Before this existed the importer wrote a BookingAssignment once at
 * cart-import time and no sync path ever revisited it (a grep for
 * `bookingAssignment` across src/lib/sync returned exactly one hit —
 * the create in importNewCart). Dispatch reassigns trucks in Planyo
 * constantly, so HQ kept the vacated unit AND never picked up the new
 * one: the old asset accumulated jobs it wasn't on, rendering as
 * phantom stacked lanes on /gantt. Measured 2026-09-02: 19 of 81 live
 * Planyo-origin bookings held 22 units Planyo no longer named.
 *
 * Wes's ruling (2026-09-02): Planyo auto-wins. It stays the team's
 * working surface until the native-scheduler switch is announced, so
 * the sync follows it rather than queueing a human decision.
 *
 * Two things it will NOT do on its own:
 *   · move a CHECKED_OUT assignment — the truck is physically gone;
 *     a paperwork edit in Planyo doesn't teleport it. Flag for a human.
 *   · move onto a unit another live assignment already overlaps —
 *     that just relocates the double-book. Flag instead.
 * Both return a NOT_APPLIED detail and write nothing; the event log
 * carries the reason.
 */
export async function applyUpdateUnit(
  prisma: PrismaClient,
  planyo: PlanyoLine,
  hqReservationRowId: string,
  cat: CrosswalkEntry,
): Promise<ApplyResult> {
  const rawUnit = (planyo.unit_assignment ?? '').trim()
  const startLA = (planyo.start_time ?? '').slice(0, 10)
  const endLA = (planyo.end_time ?? '').slice(0, 10)
  const startDb = laDateToDbDate(startLA)
  const endDb = laDateToDbDate(endLA)

  return prisma.$transaction(async (tx) => {
    const r = await tx.reservation.findUnique({
      where: { id: hqReservationRowId },
      select: { id: true, bookingId: true, unitName: true, category: true },
    })
    if (!r) throw new Error(`applyUpdateUnit: reservation ${hqReservationRowId} not found`)
    if (!r.bookingId) throw new Error(`applyUpdateUnit: reservation ${hqReservationRowId} has no parent Booking`)
    await planyoOriginBookingOrThrow(tx, r.bookingId)

    // Resolve Planyo's new unit to an Asset — same two-step the
    // importer uses (own category first, then the stale-category
    // override table).
    const target = resolvePlanyoUnitName(rawUnit, cat.name)
    if (target.isBackupHold) {
      return {
        bookingId: r.bookingId,
        bookingItemId: null,
        detail: `NOT_APPLIED backup-hold unit "${rawUnit}" — promotion is a manual operator action`,
      }
    }
    let assets = await tx.asset.findMany({
      where: { categoryId: cat.id, unitName: target.lookupName, isActive: true },
      select: { id: true, unitName: true },
    })
    if (assets.length === 0) {
      const overrideCatName = PLANYO_UNIT_CATEGORY_OVERRIDES[target.lookupName]
      if (overrideCatName) {
        assets = await tx.asset.findMany({
          where: { unitName: target.lookupName, isActive: true, category: { name: overrideCatName } },
          select: { id: true, unitName: true },
        })
      }
    }
    if (assets.length !== 1) {
      return {
        bookingId: r.bookingId,
        bookingItemId: null,
        detail: `NOT_APPLIED unit "${rawUnit}" → "${target.lookupName}" matched ${assets.length} assets in ${cat.name}`,
      }
    }
    const newAsset = assets[0]

    // Locate the assignment this line currently owns: the one sitting
    // on the unit the mirror still names. Matching on unit name (not a
    // reservation FK) because BookingAssignment carries no
    // planyoReservationId — the mirror row is the only link there is.
    //
    // Resolve that stale name against the category stored ON THE MIRROR
    // first, not the line's current crosswalk category. Planyo lines get
    // moved between resources too ("27 (A)" on Cube Truck became "Super
    // Cargo # 43" on Cargo), and normalizing the old name under the NEW
    // category yields "Cargo 27" — which matches nothing, so the real
    // Cube 27 assignment would be left behind as a ghost. Both readings
    // are tried; unit names are unique enough that a two-name IN clause
    // can't pick up an unrelated row.
    const staleNames = [...new Set([
      resolvePlanyoUnitName(r.unitName ?? '', r.category ?? cat.name).lookupName,
      resolvePlanyoUnitName(r.unitName ?? '', cat.name).lookupName,
    ])]
    const stale = staleNames[0]
    const current = await tx.bookingAssignment.findFirst({
      where: {
        bookingItem: { bookingId: r.bookingId, booking: { source: 'PLANYO_BACKFILL' } },
        asset: { unitName: { in: staleNames } },
        status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
      },
      select: { id: true, status: true, bookingItemId: true, assetId: true, endDate: true, asset: { select: { unitName: true } } },
    })

    // A rental that already ended is settled history. Planyo paperwork
    // can be edited after the fact, but the truck that physically went
    // out is what it is — and CheckoutRecord / Inspection rows hang off
    // this assignment. Rewriting it would quietly relabel a completed
    // job. Report the divergence, change nothing.
    const todayDb = new Date()
    todayDb.setUTCHours(0, 0, 0, 0)
    if (current && current.endDate < todayDb) {
      return {
        bookingId: r.bookingId,
        bookingItemId: current.bookingItemId,
        detail: `NOT_APPLIED rental already ended on ${current.asset.unitName}; Planyo now says ${newAsset.unitName} — completed history is not rewritten`,
      }
    }

    if (current?.status === 'CHECKED_OUT') {
      return {
        bookingId: r.bookingId,
        bookingItemId: current.bookingItemId,
        detail: `NOT_APPLIED assignment is CHECKED_OUT on ${current.asset.unitName} — the truck is out; Planyo now says ${newAsset.unitName}. Human call.`,
      }
    }

    // Would the move just relocate the collision? Same overlap math the
    // rest of the scheduler uses (a.start <= end AND a.end >= start).
    const blocking = await tx.bookingAssignment.findFirst({
      where: {
        assetId: newAsset.id,
        status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
        startDate: { lte: endDb },
        endDate: { gte: startDb },
        ...(current ? { id: { not: current.id } } : {}),
      },
      select: { id: true, bookingItem: { select: { booking: { select: { bookingNumber: true } } } } },
    })
    if (blocking) {
      return {
        bookingId: r.bookingId,
        bookingItemId: current?.bookingItemId ?? null,
        detail: `NOT_APPLIED ${newAsset.unitName} is already held ${startLA}→${endLA} by ${blocking.bookingItem.booking.bookingNumber}`,
      }
    }

    // Mirror follows Planyo regardless — the raw name is the fact off
    // the reservation, same as it is at import time.
    await tx.reservation.update({
      where: { id: r.id },
      data: {
        unitName: rawUnit,
        startTime: laDateStartToUTC(startLA),
        endTime: laDateEndToUTC(endLA),
      },
    })

    if (!current) {
      return {
        bookingId: r.bookingId,
        bookingItemId: null,
        detail: `mirror moved ${stale} → ${newAsset.unitName}; no live assignment on ${stale} to move`,
      }
    }

    await planyoOriginBookingItemOrThrow(tx, current.bookingItemId)
    await tx.bookingAssignment.update({
      where: { id: current.id },
      data: { assetId: newAsset.id, startDate: startDb, endDate: endDb },
    })

    return {
      bookingId: r.bookingId,
      bookingItemId: current.bookingItemId,
      detail: `moved assignment ${current.asset.unitName} → ${newAsset.unitName} (${startLA}→${endLA})`,
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
