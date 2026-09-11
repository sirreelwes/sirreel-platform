/**
 * What the partner DOES in their HQ. Every function takes the workspace
 * the token resolved to and scopes every read and write by it — a tenant
 * can only ever touch its own vendor's rows. The API routes under
 * /api/public/vendor-hq/[token] are thin wrappers over these.
 */

import type { VendorWorkspaceBookingStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { fromYmd, isYmd, overlaps, ymd } from './dates'
import { HQ_PRODUCT } from './product'
import { assignBookingDriver, notifyBookingLogistics } from './driverFlow'

export interface WsRef {
  id: string
  vendorId: string
  vendorName: string
  brandName: string
  accessToken: string
  open: boolean
}

/** Resolve the tenant from the URL token, for the API routes. */
export async function workspaceByToken(token: string): Promise<WsRef | null> {
  if (!token || token.length < 32) return null
  const r = await prisma.vendorWorkspace.findUnique({
    where: { accessToken: token },
    select: { id: true, vendorId: true, brandName: true, status: true, accessToken: true, vendor: { select: { name: true, isActive: true } } },
  })
  if (!r || !r.vendor.isActive || !r.accessToken) return null
  return { id: r.id, vendorId: r.vendorId, vendorName: r.vendor.name, brandName: r.brandName, accessToken: r.accessToken, open: r.status === 'TRIAL' || r.status === 'ACTIVE' }
}

class HqError extends Error {
  status: number
  constructor(msg: string, status = 400) {
    super(msg)
    this.status = status
  }
}

const clean = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.trim().slice(0, max) || null : null)
const money = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

async function tellHq(subject: string, line: string): Promise<void> {
  const to = await channelRecipients('vendor-portal')
  if (to.length === 0) return
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')
  await sendAgreementEmail({
    to,
    subject,
    html: `<p>${line}</p><p><a href="${base}/crm/portals#partners">${base}/crm/portals#partners</a></p>`,
    text: `${line}\n\n${base}/crm/portals#partners`,
    label: 'vendor-hq',
  }).catch(() => null)
}

// ── Conflicts ──────────────────────────────────────────────────────────

export interface Conflict {
  source: 'direct' | 'partner'
  title: string
  startDate: string
  endDate: string
}

/** Live bookings of this unit, either source, overlapping the range. */
export async function findConflicts(
  vendorId: string,
  vehicleId: string,
  start: string,
  end: string,
  excludeBookingId?: string,
): Promise<Conflict[]> {
  const [direct, partner] = await Promise.all([
    prisma.vendorWorkspaceBooking.findMany({
      where: { vehicleId, status: { in: ['HOLD', 'CONFIRMED', 'OUT'] }, ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}) },
      select: { title: true, startDate: true, endDate: true },
    }),
    prisma.subRental.findMany({
      where: { vendorId, subcontractedVehicleId: vehicleId, status: { in: ['REQUESTED', 'CONFIRMED', 'PICKED_UP', 'ON_RENT'] }, startDate: { not: null }, endDate: { not: null } },
      select: { startDate: true, endDate: true, job: { select: { name: true } }, order: { select: { job: { select: { name: true } } } } },
    }),
  ])
  const out: Conflict[] = []
  for (const d of direct) {
    const s = ymd(d.startDate)!, e = ymd(d.endDate)!
    if (overlaps(s, e, start, end)) out.push({ source: 'direct', title: d.title, startDate: s, endDate: e })
  }
  for (const p of partner) {
    const s = ymd(p.startDate)!, e = ymd(p.endDate)!
    if (overlaps(s, e, start, end)) out.push({ source: 'partner', title: p.job?.name ?? p.order?.job?.name ?? 'Partner booking', startDate: s, endDate: e })
  }
  return out
}

// ── Bookings ───────────────────────────────────────────────────────────

export interface BookingInput {
  vehicleId?: unknown
  clientId?: unknown
  title?: unknown
  startDate?: unknown
  endDate?: unknown
  status?: unknown
  dailyRate?: unknown
  location?: unknown
  callTime?: unknown
  driverName?: unknown
  notes?: unknown
  /** A roster driver (VendorDriver id) — assigning one emails them their page. */
  vendorDriverId?: unknown
  /** The partner saw the conflict and wants the booking anyway. */
  allowOverlap?: unknown
}

const STATUSES: VendorWorkspaceBookingStatus[] = ['HOLD', 'CONFIRMED', 'OUT', 'RETURNED', 'CANCELLED']

async function ownUnit(ws: WsRef, vehicleId: string) {
  const u = await prisma.subcontractedVehicle.findFirst({ where: { id: vehicleId, vendorId: ws.vendorId }, select: { id: true, name: true } })
  if (!u) throw new HqError('Pick one of your units.', 404)
  return u
}

async function ownClient(ws: WsRef, clientId: string | null) {
  if (!clientId) return null
  const c = await prisma.vendorWorkspaceClient.findFirst({ where: { id: clientId, workspaceId: ws.id }, select: { id: true } })
  if (!c) throw new HqError('That client isn’t on your list.', 404)
  return c.id
}

export async function createBooking(ws: WsRef, input: BookingInput): Promise<{ id: string } | { conflicts: Conflict[] }> {
  const vehicleId = clean(input.vehicleId, 64)
  const title = clean(input.title, 200)
  if (!vehicleId) throw new HqError('Pick a unit.')
  if (!title) throw new HqError('Give the booking a name — the show or the client.')
  if (!isYmd(input.startDate) || !isYmd(input.endDate)) throw new HqError('Enter a start and end date.')
  if (input.endDate < input.startDate) throw new HqError('The end date is before the start date.')
  const status = STATUSES.includes(input.status as VendorWorkspaceBookingStatus) ? (input.status as VendorWorkspaceBookingStatus) : 'HOLD'
  await ownUnit(ws, vehicleId)
  const clientId = await ownClient(ws, clean(input.clientId, 64))
  if (status !== 'CANCELLED' && input.allowOverlap !== true) {
    const conflicts = await findConflicts(ws.vendorId, vehicleId, input.startDate, input.endDate)
    if (conflicts.length) return { conflicts }
  }
  const row = await prisma.vendorWorkspaceBooking.create({
    data: {
      workspaceId: ws.id,
      vehicleId,
      clientId,
      title,
      startDate: fromYmd(input.startDate),
      endDate: fromYmd(input.endDate),
      status,
      dailyRate: money(input.dailyRate),
      location: clean(input.location, 600),
      callTime: clean(input.callTime, 120),
      driverName: clean(input.driverName, 120),
      notes: clean(input.notes, 2000),
    },
    select: { id: true },
  })
  const driverId = clean(input.vendorDriverId, 64)
  if (driverId) await assignBookingDriver(ws, row.id, driverId)
  return { id: row.id }
}

export async function updateBooking(ws: WsRef, id: string, input: BookingInput): Promise<{ ok: true } | { conflicts: Conflict[] }> {
  const existing = await prisma.vendorWorkspaceBooking.findFirst({ where: { id, workspaceId: ws.id }, select: { id: true, vehicleId: true, startDate: true, endDate: true, status: true, callTime: true, location: true, vendorDriverId: true } })
  if (!existing) throw new HqError('Booking not found.', 404)
  const data: Record<string, unknown> = {}
  if (input.vehicleId !== undefined) {
    const vehicleId = clean(input.vehicleId, 64)
    if (!vehicleId) throw new HqError('Pick a unit.')
    await ownUnit(ws, vehicleId)
    data.vehicleId = vehicleId
  }
  if (input.clientId !== undefined) data.clientId = await ownClient(ws, clean(input.clientId, 64))
  if (input.title !== undefined) {
    const t = clean(input.title, 200)
    if (!t) throw new HqError('The booking needs a name.')
    data.title = t
  }
  if (input.startDate !== undefined) {
    if (!isYmd(input.startDate)) throw new HqError('Enter a start date.')
    data.startDate = fromYmd(input.startDate)
  }
  if (input.endDate !== undefined) {
    if (!isYmd(input.endDate)) throw new HqError('Enter an end date.')
    data.endDate = fromYmd(input.endDate)
  }
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status as VendorWorkspaceBookingStatus)) throw new HqError('Unknown status.')
    data.status = input.status
  }
  if (input.dailyRate !== undefined) data.dailyRate = money(input.dailyRate)
  if (input.location !== undefined) data.location = clean(input.location, 600)
  if (input.callTime !== undefined) data.callTime = clean(input.callTime, 120)
  if (input.driverName !== undefined) data.driverName = clean(input.driverName, 120)
  if (input.notes !== undefined) data.notes = clean(input.notes, 2000)

  const start = ymd((data.startDate as Date | undefined) ?? existing.startDate)!
  const end = ymd((data.endDate as Date | undefined) ?? existing.endDate)!
  if (end < start) throw new HqError('The end date is before the start date.')
  const status = (data.status as VendorWorkspaceBookingStatus | undefined) ?? existing.status
  const vehicleId = (data.vehicleId as string | undefined) ?? existing.vehicleId
  const datesOrUnitChanged = data.startDate !== undefined || data.endDate !== undefined || data.vehicleId !== undefined
  if (status !== 'CANCELLED' && status !== 'RETURNED' && datesOrUnitChanged && input.allowOverlap !== true) {
    const conflicts = await findConflicts(ws.vendorId, vehicleId, start, end, existing.id)
    if (conflicts.length) return { conflicts }
  }
  await prisma.vendorWorkspaceBooking.update({ where: { id: existing.id }, data })

  // The driver conduit. A new driver gets their page; a driver already on
  // it hears about the things that change their day.
  if (input.vendorDriverId !== undefined) {
    await assignBookingDriver(ws, existing.id, clean(input.vendorDriverId, 64))
  }
  const driverStays = input.vendorDriverId === undefined ? !!existing.vendorDriverId : clean(input.vendorDriverId, 64) === existing.vendorDriverId && !!existing.vendorDriverId
  if (driverStays) {
    const changed: string[] = []
    if (data.callTime !== undefined && data.callTime !== existing.callTime) changed.push('call time')
    if (data.location !== undefined && data.location !== existing.location) changed.push('location')
    if ((data.startDate !== undefined && start !== ymd(existing.startDate)) || (data.endDate !== undefined && end !== ymd(existing.endDate))) changed.push('dates')
    if (changed.length) await notifyBookingLogistics(existing.id, changed)
  }
  return { ok: true }
}

// ── Clients ────────────────────────────────────────────────────────────

export interface ClientInput {
  name?: unknown
  contactName?: unknown
  email?: unknown
  phone?: unknown
  notes?: unknown
}

export async function createClient(ws: WsRef, input: ClientInput): Promise<{ id: string }> {
  const name = clean(input.name, 160)
  if (!name) throw new HqError('The client needs a name.')
  const row = await prisma.vendorWorkspaceClient.create({
    data: {
      workspaceId: ws.id,
      name,
      contactName: clean(input.contactName, 120),
      email: clean(input.email, 200)?.toLowerCase() ?? null,
      phone: clean(input.phone, 30),
      notes: clean(input.notes, 2000),
    },
    select: { id: true },
  })
  return { id: row.id }
}

export async function updateClient(ws: WsRef, id: string, input: ClientInput): Promise<void> {
  const existing = await prisma.vendorWorkspaceClient.findFirst({ where: { id, workspaceId: ws.id }, select: { id: true } })
  if (!existing) throw new HqError('Client not found.', 404)
  const data: Record<string, unknown> = {}
  if (input.name !== undefined) {
    const n = clean(input.name, 160)
    if (!n) throw new HqError('The client needs a name.')
    data.name = n
  }
  if (input.contactName !== undefined) data.contactName = clean(input.contactName, 120)
  if (input.email !== undefined) data.email = clean(input.email, 200)?.toLowerCase() ?? null
  if (input.phone !== undefined) data.phone = clean(input.phone, 30)
  if (input.notes !== undefined) data.notes = clean(input.notes, 2000)
  await prisma.vendorWorkspaceClient.update({ where: { id: existing.id }, data })
}

// ── Fleet ──────────────────────────────────────────────────────────────

export interface UnitInput {
  name?: unknown
  vehicleType?: unknown
  daily?: unknown
  weekly?: unknown
  monthly?: unknown
  rateNotes?: unknown
  specs?: unknown
  active?: unknown
  /** Offer the unit to SirReel for sublease. Flipping this tells HQ. */
  offeredToPartner?: unknown
}

/**
 * A unit the partner adds in THEIR HQ starts as theirs alone
 * (offeredToSirReel false) — offering it to SirReel is a separate, visible
 * choice, and one HQ hears about.
 */
export async function createUnit(ws: WsRef, input: UnitInput): Promise<{ id: string }> {
  const name = clean(input.name, 120)
  if (!name) throw new HqError('Give the unit a name.')
  const offered = input.offeredToPartner === true
  const row = await prisma.subcontractedVehicle.create({
    data: {
      vendorId: ws.vendorId,
      name,
      vehicleType: clean(input.vehicleType, 80),
      listDailyRate: money(input.daily),
      listWeeklyRate: money(input.weekly),
      listMonthlyRate: money(input.monthly),
      rateNotes: clean(input.rateNotes, 1000),
      specs: clean(input.specs, 4000),
      offeredToSirReel: offered,
    },
    select: { id: true },
  })
  if (offered) {
    await tellHq(
      `${ws.vendorName} added a unit for SirReel: ${name}`,
      `${ws.vendorName} added “${name}” in their ${HQ_PRODUCT.name} workspace and offered it to SirReel for sublease. Check its rates and discount on the roster before quoting it.`,
    )
  }
  return { id: row.id }
}

/**
 * Rates on a unit OFFERED to SirReel are SirReel's list rates — the
 * partner changes those by proposal on their partner page, not here, so
 * a cost rise stays a margin decision for HQ. Units kept to themselves
 * are theirs to price freely.
 */
export async function updateUnit(ws: WsRef, unitId: string, input: UnitInput): Promise<void> {
  const u = await prisma.subcontractedVehicle.findFirst({
    where: { id: unitId, vendorId: ws.vendorId },
    select: { id: true, name: true, offeredToSirReel: true, subRentals: { where: { status: { in: ['REQUESTED', 'CONFIRMED', 'PICKED_UP', 'ON_RENT'] } }, select: { id: true }, take: 1 } },
  })
  if (!u) throw new HqError('Unit not found.', 404)
  const data: Record<string, unknown> = {}
  if (input.name !== undefined) {
    const n = clean(input.name, 120)
    if (!n) throw new HqError('The unit needs a name.')
    data.name = n
  }
  if (input.vehicleType !== undefined) data.vehicleType = clean(input.vehicleType, 80)
  if (input.specs !== undefined) data.specs = clean(input.specs, 4000)
  if (input.rateNotes !== undefined) data.rateNotes = clean(input.rateNotes, 1000)
  if (input.active !== undefined) data.isActive = input.active === true
  const wantsRates = input.daily !== undefined || input.weekly !== undefined || input.monthly !== undefined
  const nowOffered = input.offeredToPartner === undefined ? u.offeredToSirReel : input.offeredToPartner === true
  if (wantsRates) {
    if (u.offeredToSirReel) throw new HqError('This unit is shared with a rental partner, so its rates are agreed with them — propose a change on that partner\'s page.')
    if (input.daily !== undefined) data.listDailyRate = money(input.daily)
    if (input.weekly !== undefined) data.listWeeklyRate = money(input.weekly)
    if (input.monthly !== undefined) data.listMonthlyRate = money(input.monthly)
  }
  if (input.offeredToPartner !== undefined && nowOffered !== u.offeredToSirReel) {
    if (!nowOffered && u.subRentals.length) throw new HqError('A partner has a live booking on this unit — finish that before withdrawing it.')
    data.offeredToSirReel = nowOffered
  }
  if (!Object.keys(data).length) return
  await prisma.subcontractedVehicle.update({ where: { id: u.id }, data })
  if (data.offeredToSirReel !== undefined) {
    await tellHq(
      nowOffered ? `${ws.vendorName} offered a unit to SirReel: ${(data.name as string) ?? u.name}` : `${ws.vendorName} withdrew a unit from SirReel: ${(data.name as string) ?? u.name}`,
      nowOffered
        ? `${ws.vendorName} offered “${(data.name as string) ?? u.name}” to SirReel for sublease from their ${HQ_PRODUCT.name} workspace. Check its rates and discount on the roster before quoting it.`
        : `${ws.vendorName} withdrew “${(data.name as string) ?? u.name}” from SirReel in their ${HQ_PRODUCT.name} workspace. It no longer appears on the roster or in quotes.`,
    )
  }
}

// ── Settings ───────────────────────────────────────────────────────────

export async function updateSettings(ws: WsRef, input: { brandName?: unknown; accentColor?: unknown }): Promise<void> {
  const data: Record<string, unknown> = {}
  if (input.brandName !== undefined) {
    const n = clean(input.brandName, 80)
    if (!n) throw new HqError('Your workspace needs a name.')
    data.brandName = n
  }
  if (input.accentColor !== undefined) {
    const c = clean(input.accentColor, 9)
    if (c && !/^#[0-9a-fA-F]{6}$/.test(c)) throw new HqError('Accent must be a hex colour like #1f3a5f.')
    data.accentColor = c ? c.toLowerCase() : null
  }
  if (!Object.keys(data).length) return
  await prisma.vendorWorkspace.update({ where: { id: ws.id }, data })
}

export function errorStatus(e: unknown): number {
  return e instanceof HqError ? e.status : typeof (e as { status?: number })?.status === 'number' ? (e as { status: number }).status : 500
}
