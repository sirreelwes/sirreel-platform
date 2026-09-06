/**
 * What the partner SEES in their HQ — read models only.
 *
 * The one idea here: a booking is a booking whichever way it came in. The
 * partner's own bookings are VendorWorkspaceBooking rows; SirReel's
 * sub-rentals of the same units are SubRental rows. Both are shaped into
 * one HqBooking so the calendar, the bookings list and the Today page
 * never have to know which is which — except to say so with a chip, and
 * to send a SirReel booking to its conduit page instead of an edit form
 * (the partner works those with SirReel, not here).
 */

import type { SubRentalStatus, VendorWorkspaceBookingStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { vendorPageUrl } from '@/lib/sub-rentals/conduit'
import { driverPageUrl } from './driverFlow'
import { addDays, daysOfMonth, overlaps, todayPacific, ymd } from './dates'
import type { HqWorkspace } from './workspace'

export type HqBookingStatus = VendorWorkspaceBookingStatus | 'QUOTED'
export type HqBookingSource = 'direct' | 'partner'

export interface HqBooking {
  id: string
  source: HqBookingSource
  vehicleId: string | null
  vehicleName: string
  quantity: number
  title: string
  clientName: string | null
  clientId: string | null
  startDate: string | null
  endDate: string | null
  status: HqBookingStatus
  callTime: string | null
  driverName: string | null
  location: string | null
  notes: string | null
  dailyRate: number | null
  /** Where this row is worked: the edit page (direct) or the partner's page (via SirReel). */
  href: string | null
  /** Something still owed (confirm / driver / call time / driver hasn't confirmed). */
  needs: string[]
  /** Direct bookings only: where the driver is in their day. */
  driver: { id: string | null; acked: boolean; ackStale: boolean; rolling: boolean; back: boolean; pageUrl: string | null } | null
}

export interface HqUnit {
  id: string
  name: string
  vehicleType: string | null
  active: boolean
  offeredToPartner: boolean
  daily: number | null
  weekly: number | null
  monthly: number | null
  rateNotes: string | null
  specs: string | null
}

export interface HqClient {
  id: string
  name: string
  contactName: string | null
  email: string | null
  phone: string | null
  notes: string | null
  bookingCount: number
}

const LIVE: HqBookingStatus[] = ['HOLD', 'CONFIRMED', 'OUT']

const PARTNER_STATUS: Record<SubRentalStatus, HqBookingStatus> = {
  ESTIMATED: 'QUOTED',
  REQUESTED: 'HOLD',
  CONFIRMED: 'CONFIRMED',
  PICKED_UP: 'OUT',
  ON_RENT: 'OUT',
  RETURNED: 'RETURNED',
  CANCELLED: 'CANCELLED',
}

const num = (d: unknown) => (d == null ? null : Number(d))

export async function loadUnits(ws: HqWorkspace, opts: { includeInactive?: boolean } = {}): Promise<HqUnit[]> {
  const rows = await prisma.subcontractedVehicle.findMany({
    where: { vendorId: ws.vendorId, ...(opts.includeInactive ? {} : { isActive: true }) },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: {
      id: true, name: true, vehicleType: true, isActive: true, offeredToSirReel: true,
      listDailyRate: true, listWeeklyRate: true, listMonthlyRate: true, rateNotes: true, specs: true,
    },
  })
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    vehicleType: u.vehicleType,
    active: u.isActive,
    offeredToPartner: u.offeredToSirReel,
    daily: num(u.listDailyRate),
    weekly: num(u.listWeeklyRate),
    monthly: num(u.listMonthlyRate),
    rateNotes: u.rateNotes,
    specs: u.specs,
  }))
}

export async function loadUnit(ws: HqWorkspace, unitId: string): Promise<HqUnit | null> {
  const all = await loadUnits(ws, { includeInactive: true })
  return all.find((u) => u.id === unitId) ?? null
}

/**
 * Every booking touching [from, to] (YYYY-MM-DD, inclusive), both sources.
 * Undated partner rows (a quote without dates yet) ride along when the
 * range is open-ended so they show in the list, never on the calendar.
 */
export async function loadBookings(
  ws: HqWorkspace,
  range: { from?: string; to?: string } = {},
): Promise<HqBooking[]> {
  const dateWhere =
    range.from || range.to
      ? {
          ...(range.to ? { startDate: { lte: new Date(`${range.to}T00:00:00Z`) } } : {}),
          ...(range.from ? { endDate: { gte: new Date(`${range.from}T00:00:00Z`) } } : {}),
        }
      : {}
  const [direct, partner] = await Promise.all([
    prisma.vendorWorkspaceBooking.findMany({
      where: { workspaceId: ws.id, ...dateWhere },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
      take: 500,
      select: {
        id: true, vehicleId: true, title: true, startDate: true, endDate: true, status: true,
        dailyRate: true, location: true, callTime: true, driverName: true, notes: true, clientId: true,
        vendorDriverId: true, driverToken: true, driverAckedAt: true, logisticsUpdatedAt: true, rollingAt: true, backAt: true,
        vehicle: { select: { name: true } },
        client: { select: { name: true } },
      },
    }),
    prisma.subRental.findMany({
      where: {
        vendorId: ws.vendorId,
        ...(range.from || range.to
          ? { OR: [dateWhere, { startDate: null, endDate: null }] }
          : {}),
      },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
      take: 500,
      select: {
        id: true, subcontractedVehicleId: true, itemDescription: true, quantity: true, startDate: true, endDate: true, status: true,
        callTime: true, driverName: true, vendorConfirmedAt: true, vendorDeclinedAt: true, driverAckedAt: true, vendorToken: true,
        subcontractedVehicle: { select: { name: true } },
        job: { select: { name: true, jobCode: true } },
        order: { select: { orderNumber: true, job: { select: { name: true, jobCode: true } } } },
      },
    }),
  ])

  const out: HqBooking[] = []
  for (const b of direct) {
    const needs: string[] = []
    const live = b.status === 'HOLD' || b.status === 'CONFIRMED' || b.status === 'OUT'
    if (live && !b.vendorDriverId && !b.driverName) needs.push('Name a driver')
    if (live && b.vendorDriverId && !b.driverAckedAt) needs.push('Driver hasn’t confirmed')
    if (live && b.vendorDriverId && b.driverAckedAt && b.logisticsUpdatedAt && b.logisticsUpdatedAt > b.driverAckedAt) needs.push('Driver hasn’t seen the change')
    if (live && !b.callTime) needs.push('Set a call time')
    out.push({
      id: b.id,
      source: 'direct',
      vehicleId: b.vehicleId,
      vehicleName: b.vehicle.name,
      quantity: 1,
      title: b.title,
      clientName: b.client?.name ?? null,
      clientId: b.clientId,
      startDate: ymd(b.startDate),
      endDate: ymd(b.endDate),
      status: b.status,
      callTime: b.callTime,
      driverName: b.driverName,
      location: b.location,
      notes: b.notes,
      dailyRate: num(b.dailyRate),
      href: `/hq/${ws.accessToken}/bookings/${b.id}`,
      needs,
      driver: b.vendorDriverId
        ? { id: b.vendorDriverId, acked: !!b.driverAckedAt, ackStale: !!(b.driverAckedAt && b.logisticsUpdatedAt && b.logisticsUpdatedAt > b.driverAckedAt), rolling: !!b.rollingAt, back: !!b.backAt, pageUrl: b.driverToken ? driverPageUrl(b.driverToken) : null }
        : null,
    })
  }
  for (const r of partner) {
    const job = r.job ?? r.order?.job ?? null
    const status = r.vendorDeclinedAt && r.status === 'REQUESTED' ? 'CANCELLED' : PARTNER_STATUS[r.status]
    const needs: string[] = []
    if (r.status === 'REQUESTED' && !r.vendorConfirmedAt && !r.vendorDeclinedAt) needs.push('Confirm the hold')
    if ((r.status === 'REQUESTED' || r.status === 'CONFIRMED') && !r.driverName) needs.push('Name a driver')
    if ((r.status === 'CONFIRMED' || r.status === 'PICKED_UP') && r.driverName && !r.driverAckedAt) needs.push('Driver hasn’t confirmed')
    out.push({
      id: `sr:${r.id}`,
      source: 'partner',
      vehicleId: r.subcontractedVehicleId,
      vehicleName: r.subcontractedVehicle?.name ?? r.itemDescription,
      quantity: r.quantity,
      title: job?.name || job?.jobCode || (r.order?.orderNumber ? `Order ${r.order.orderNumber}` : 'Booking'),
      clientName: 'SirReel',
      clientId: null,
      startDate: ymd(r.startDate),
      endDate: ymd(r.endDate),
      status,
      callTime: r.callTime,
      driverName: r.driverName,
      location: null,
      notes: null,
      dailyRate: null,
      href: r.vendorToken ? vendorPageUrl(r.vendorToken) : null,
      needs,
      driver: null,
    })
  }
  out.sort((a, b) => (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999') || a.vehicleName.localeCompare(b.vehicleName))
  return out
}

export async function loadBooking(ws: HqWorkspace, id: string): Promise<HqBooking | null> {
  const all = await loadBookings(ws)
  return all.find((b) => b.id === id) ?? null
}

export async function loadClients(ws: HqWorkspace): Promise<HqClient[]> {
  const rows = await prisma.vendorWorkspaceClient.findMany({
    where: { workspaceId: ws.id },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, contactName: true, email: true, phone: true, notes: true, _count: { select: { bookings: true } } },
  })
  return rows.map((c) => ({ id: c.id, name: c.name, contactName: c.contactName, email: c.email, phone: c.phone, notes: c.notes, bookingCount: c._count.bookings }))
}

export async function loadClient(ws: HqWorkspace, id: string): Promise<HqClient | null> {
  const all = await loadClients(ws)
  return all.find((c) => c.id === id) ?? null
}

// ── Today ──────────────────────────────────────────────────────────────

export interface HqToday {
  today: string
  goingOut: HqBooking[]
  comingBack: HqBooking[]
  onRent: HqBooking[]
  /** Partner bookings still owing something (confirm / driver / ack). */
  needsAnswer: HqBooking[]
  /** Next 14 days, excluding today's movements. */
  upcoming: HqBooking[]
  unitCount: number
  unitsOutToday: number
}

export async function loadToday(ws: HqWorkspace): Promise<HqToday> {
  const today = todayPacific()
  const horizon = addDays(today, 14)
  const [rows, unitCount] = await Promise.all([
    loadBookings(ws, { from: today, to: horizon }),
    prisma.subcontractedVehicle.count({ where: { vendorId: ws.vendorId, isActive: true } }),
  ])
  const live = rows.filter((b) => LIVE.includes(b.status))
  const covering = (b: HqBooking) => !!b.startDate && !!b.endDate && b.startDate <= today && today <= b.endDate
  const goingOut = live.filter((b) => b.startDate === today)
  const comingBack = live.filter((b) => b.endDate === today && b.startDate !== today)
  const onRent = live.filter((b) => covering(b) && b.startDate !== today && b.endDate !== today)
  const needsAnswer = rows.filter((b) => b.needs.length > 0)
  const upcoming = live.filter((b) => !!b.startDate && b.startDate > today)
  const outToday = new Set(live.filter(covering).map((b) => b.vehicleId ?? b.id))
  return { today, goingOut, comingBack, onRent, needsAnswer, upcoming, unitCount, unitsOutToday: outToday.size }
}

// ── Calendar ───────────────────────────────────────────────────────────

export interface HqCalendarBar {
  booking: HqBooking
  /** Index into HqCalendar.days of the bar's first visible day. */
  startIdx: number
  /** Visible days, clipped to the month. */
  span: number
  /** Which lane of the unit's row the bar sits in (0 = top). */
  lane: number
  /** Overlaps another LIVE booking of the same unit — a double-book. */
  conflict: boolean
}

export interface HqCalendarRow {
  unitId: string | null
  unitName: string
  vehicleType: string | null
  bars: HqCalendarBar[]
  laneCount: number
}

export interface HqCalendar {
  month: string
  days: string[]
  today: string
  rows: HqCalendarRow[]
}

/**
 * One row per unit, one bar per booking. Bookings that overlap in time
 * stack into lanes so both stay visible; two LIVE ones overlapping is a
 * double-book and both bars are flagged.
 */
export async function loadCalendar(ws: HqWorkspace, month: string): Promise<HqCalendar> {
  const days = daysOfMonth(month)
  const from = days[0]
  const to = days[days.length - 1]
  const [units, bookings] = await Promise.all([loadUnits(ws), loadBookings(ws, { from, to })])
  const rows: HqCalendarRow[] = units.map((u) => ({ unitId: u.id, unitName: u.name, vehicleType: u.vehicleType, bars: [], laneCount: 1 }))
  const other: HqCalendarRow = { unitId: null, unitName: 'Not on your roster', vehicleType: null, bars: [], laneCount: 1 }
  const idx = new Map(days.map((d, i) => [d, i]))

  for (const b of bookings) {
    if (!b.startDate || !b.endDate || b.status === 'CANCELLED') continue
    if (!overlaps(b.startDate, b.endDate, from, to)) continue
    const row = rows.find((r) => r.unitId === b.vehicleId) ?? other
    const start = b.startDate < from ? from : b.startDate
    const end = b.endDate > to ? to : b.endDate
    const startIdx = idx.get(start)!
    const span = idx.get(end)! - startIdx + 1
    row.bars.push({ booking: b, startIdx, span, lane: 0, conflict: false })
  }

  for (const row of [...rows, other]) {
    row.bars.sort((a, b) => a.startIdx - b.startIdx || b.span - a.span)
    const laneEnds: number[] = []
    for (const bar of row.bars) {
      let lane = laneEnds.findIndex((e) => e < bar.startIdx)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(-1)
      }
      laneEnds[lane] = bar.startIdx + bar.span - 1
      bar.lane = lane
    }
    row.laneCount = Math.max(1, laneEnds.length)
    for (const a of row.bars) {
      if (!LIVE.includes(a.booking.status)) continue
      for (const b of row.bars) {
        if (a === b || !LIVE.includes(b.booking.status)) continue
        if (a.startIdx <= b.startIdx + b.span - 1 && b.startIdx <= a.startIdx + a.span - 1) a.conflict = true
      }
    }
  }
  if (other.bars.length) rows.push(other)
  return { month, days, today: todayPacific(), rows }
}
