/**
 * The driver conduit for a partner's OWN bookings in Utliiz.
 *
 * Wes 2026-09-06: "driver communication is a pain point… can Utliiz send
 * emails to the drivers for check in / out." Mirrors the SirReel sub-rental
 * conduit, minus SirReel: the partner names a roster driver on a booking →
 * the driver gets a page of their own (token = credential, like every
 * driver page here) → the call time / address changes reach them → they
 * say "I have it" → the evening-before reminder → "Rolling" with the meters
 * → "Back on the lot" with the meters → hours from the same page. Every
 * stamp is a column on the booking so the office reads it on Today.
 */
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { listHours, type HoursView } from '@/lib/drivers/hoursStore'
import { driverDisplayName, profilePageUrl } from '@/lib/sub-rentals/vendorDrivers'
import { HQ_PRODUCT } from './product'
import { ymd, todayPacific, addDays } from './dates'
import { buildDriverAssignment, buildDriverInvite, buildDriverReminder, buildDriverUpdate, type DriverMailArgs } from './driverEmails'

export function driverPagePath(token: string): string {
  return `/drive/booking/${token}`
}
export function driverPageUrl(token: string): string {
  return `${HQ_PRODUCT.origin}${driverPagePath(token)}`
}

const BOOKING_SELECT = {
  id: true, title: true, startDate: true, endDate: true, status: true, callTime: true, location: true, notes: true, driverName: true,
  vendorDriverId: true, driverToken: true, driverNotifiedAt: true, logisticsUpdatedAt: true, reminderSentAt: true,
  driverAckedAt: true, driverAckNote: true, rollingAt: true, checkOutOdometer: true, checkOutGenerator: true, checkOutNotes: true,
  backAt: true, checkInOdometer: true, checkInGenerator: true, checkInNotes: true,
  vehicle: { select: { name: true } },
  vendorDriver: { select: { id: true, email: true, firstName: true, lastName: true, phone: true } },
  workspace: { select: { id: true, brandName: true, accentColor: true, vendorId: true, vendor: { select: { name: true, email: true, lotAddress: true } } } },
} as const

type BookingRow = NonNullable<Awaited<ReturnType<typeof loadBookingRow>>>
async function loadBookingRow(id: string) {
  return prisma.vendorWorkspaceBooking.findUnique({ where: { id }, select: BOOKING_SELECT })
}

function mailArgs(b: BookingRow): DriverMailArgs | null {
  if (!b.driverToken || !b.startDate || !b.endDate) return null
  return {
    brandName: b.workspace.brandName,
    accent: b.workspace.accentColor || HQ_PRODUCT.defaultAccent,
    driverName: b.vendorDriver ? driverDisplayName(b.vendorDriver) : b.driverName,
    unitName: b.vehicle.name,
    title: b.title,
    startDate: ymd(b.startDate)!,
    endDate: ymd(b.endDate)!,
    callTime: b.callTime,
    location: b.location,
    notes: b.notes,
    driverUrl: driverPageUrl(b.driverToken),
  }
}

async function mailDriver(b: BookingRow, m: { subject: string; html: string; text: string }, label: string): Promise<boolean> {
  const to = b.vendorDriver?.email
  if (!to) return false
  const res = await sendAgreementEmail({
    to: [to],
    from: HQ_PRODUCT.sendFrom ?? undefined,
    replyTo: b.workspace.vendor.email ?? undefined,
    subject: m.subject, html: m.html, text: m.text, label,
  }).catch(() => ({ ok: false as const, reason: 'send threw' }))
  return res.ok
}

// ── Roster ─────────────────────────────────────────────────────────────

/** The partner adds a driver by email; the driver fills their own profile. */
export async function addWorkspaceDriver(ws: { id: string; vendorId: string; brandName: string }, input: { email: unknown; name?: unknown }): Promise<{ id: string; invited: boolean; existed: boolean }> {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('A working email, please.'), { status: 400 })
  const parts = (typeof input.name === 'string' ? input.name : '').trim().split(/\s+/).filter(Boolean)
  const existing = await prisma.vendorDriver.findUnique({ where: { vendorId_email: { vendorId: ws.vendorId, email } }, select: { id: true, profileToken: true, firstName: true, lastName: true } })
  const token = existing?.profileToken ?? randomBytes(32).toString('hex')
  const row = existing
    ? await prisma.vendorDriver.update({ where: { id: existing.id }, data: { isActive: true, firstName: existing.firstName ?? parts[0] ?? null, lastName: existing.lastName ?? (parts.slice(1).join(' ') || null), profileToken: token, profileTokenMintedAt: existing.profileToken ? undefined : new Date(), invitedAt: new Date() }, select: { id: true, firstName: true, lastName: true, email: true } })
    : await prisma.vendorDriver.create({ data: { vendorId: ws.vendorId, email, firstName: parts[0] ?? null, lastName: parts.slice(1).join(' ') || null, profileToken: token, profileTokenMintedAt: new Date(), invitedAt: new Date() }, select: { id: true, firstName: true, lastName: true, email: true } })
  const wsRow = await prisma.vendorWorkspace.findUnique({ where: { id: ws.id }, select: { accentColor: true } })
  const mail = buildDriverInvite({ brandName: ws.brandName, accent: wsRow?.accentColor || HQ_PRODUCT.defaultAccent, driverName: row.firstName ? driverDisplayName(row) : null, profileUrl: profilePageUrl(token) })
  const res = await sendAgreementEmail({ to: [email], from: HQ_PRODUCT.sendFrom ?? undefined, subject: mail.subject, html: mail.html, text: mail.text, label: 'utliiz-driver/invite' }).catch(() => ({ ok: false as const, reason: 'send threw' }))
  return { id: row.id, invited: res.ok, existed: !!existing }
}

export interface WorkspaceDriver {
  id: string; name: string; email: string; phone: string | null; profileComplete: boolean; invitedAt: string | null; profileViewedAt: string | null
  /** Bookings this driver is on, from today. */
  upcoming: number
}

export async function listWorkspaceDrivers(vendorId: string): Promise<WorkspaceDriver[]> {
  const today = new Date(`${todayPacific()}T00:00:00Z`)
  const rows = await prisma.vendorDriver.findMany({
    where: { vendorId, isActive: true },
    orderBy: [{ firstName: 'asc' }, { email: 'asc' }],
    select: { id: true, email: true, firstName: true, lastName: true, phone: true, profileCompletedAt: true, invitedAt: true, profileViewedAt: true, _count: { select: { workspaceBookings: { where: { endDate: { gte: today }, status: { in: ['HOLD', 'CONFIRMED', 'OUT'] } } } } } },
  })
  return rows.map((d) => ({ id: d.id, name: driverDisplayName(d), email: d.email, phone: d.phone, profileComplete: !!d.profileCompletedAt, invitedAt: d.invitedAt?.toISOString() ?? null, profileViewedAt: d.profileViewedAt?.toISOString() ?? null, upcoming: d._count.workspaceBookings }))
}

// ── Assignment + logistics ─────────────────────────────────────────────

/**
 * Put a roster driver on a booking (or take them off with null). A new
 * driver gets a fresh token — the old driver's page dies — and the
 * assignment email. Same driver again is a no-op.
 */
export async function assignBookingDriver(ws: { id: string; vendorId: string }, bookingId: string, vendorDriverId: string | null): Promise<{ notified: boolean }> {
  const b = await prisma.vendorWorkspaceBooking.findFirst({ where: { id: bookingId, workspaceId: ws.id }, select: { id: true, vendorDriverId: true } })
  if (!b) throw Object.assign(new Error('Booking not found.'), { status: 404 })
  if (b.vendorDriverId === vendorDriverId) return { notified: false }
  if (!vendorDriverId) {
    await prisma.vendorWorkspaceBooking.update({ where: { id: b.id }, data: { vendorDriverId: null, driverName: null, driverToken: null, driverTokenMintedAt: null, driverNotifiedAt: null, driverAckedAt: null, driverAckNote: null, reminderSentAt: null } })
    return { notified: false }
  }
  const d = await prisma.vendorDriver.findFirst({ where: { id: vendorDriverId, vendorId: ws.vendorId, isActive: true }, select: { id: true, email: true, firstName: true, lastName: true } })
  if (!d) throw Object.assign(new Error('Pick a driver from your list.'), { status: 404 })
  await prisma.vendorWorkspaceBooking.update({
    where: { id: b.id },
    data: { vendorDriverId: d.id, driverName: driverDisplayName(d), driverToken: randomBytes(32).toString('base64url'), driverTokenMintedAt: new Date(), driverAckedAt: null, driverAckNote: null, reminderSentAt: null, driverNotifiedAt: null },
  })
  const row = await loadBookingRow(b.id)
  const args = row && mailArgs(row)
  if (!row || !args) return { notified: false }
  const ok = await mailDriver(row, buildDriverAssignment(args), 'utliiz-driver/assignment')
  if (ok) await prisma.vendorWorkspaceBooking.update({ where: { id: b.id }, data: { driverNotifiedAt: new Date() } })
  return { notified: ok }
}

/** Call time / location / dates changed on a booking with a driver: tell them. */
export async function notifyBookingLogistics(bookingId: string, changed: string[]): Promise<boolean> {
  const row = await loadBookingRow(bookingId)
  if (!row || !row.vendorDriverId) return false
  await prisma.vendorWorkspaceBooking.update({ where: { id: bookingId }, data: { logisticsUpdatedAt: new Date() } })
  const args = mailArgs(row)
  if (!args) return false
  return mailDriver(row, buildDriverUpdate(args, changed), 'utliiz-driver/update')
}

/** Cron: the evening before day one, once. */
export async function sendDriverReminders(): Promise<{ sent: number; skipped: number }> {
  const tomorrow = new Date(`${addDays(todayPacific(), 1)}T00:00:00Z`)
  const rows = await prisma.vendorWorkspaceBooking.findMany({
    where: { startDate: tomorrow, status: { in: ['HOLD', 'CONFIRMED'] }, vendorDriverId: { not: null }, driverToken: { not: null }, reminderSentAt: null },
    select: { id: true },
  })
  let sent = 0, skipped = 0
  for (const { id } of rows) {
    const row = await loadBookingRow(id)
    const args = row && mailArgs(row)
    if (!row || !args) { skipped++; continue }
    const ok = await mailDriver(row, buildDriverReminder(args), 'utliiz-driver/reminder')
    if (ok) { sent++; await prisma.vendorWorkspaceBooking.update({ where: { id }, data: { reminderSentAt: new Date() } }) } else skipped++
  }
  return { sent, skipped }
}

// ── The driver's page ──────────────────────────────────────────────────

export interface DriverBookingView {
  brandName: string
  accent: string
  driverName: string | null
  unitName: string
  title: string
  status: string
  startDate: string | null
  endDate: string | null
  callTime: string | null
  location: string | null
  notes: string | null
  leavingFrom: string | null
  officePhone: string | null
  acked: { at: string; note: string | null; stale: boolean } | null
  rolling: { at: string; odometer: number | null; generator: number | null; notes: string | null } | null
  back: { at: string; odometer: number | null; generator: number | null; notes: string | null } | null
  hours: HoursView
  today: string
  closed: boolean
}

export async function loadDriverBooking(token: string, opts: { stamp?: boolean } = {}): Promise<DriverBookingView | null> {
  if (!token || token.length < 32) return null
  const b = await prisma.vendorWorkspaceBooking.findUnique({ where: { driverToken: token }, select: { ...BOOKING_SELECT, workspace: { select: { ...BOOKING_SELECT.workspace.select, vendor: { select: { name: true, email: true, lotAddress: true, phone: true } } } } } })
  if (!b) return null
  const num = (v: unknown) => (v == null ? null : Number(String(v)))
  return {
    brandName: b.workspace.brandName,
    accent: b.workspace.accentColor || HQ_PRODUCT.defaultAccent,
    driverName: b.vendorDriver ? driverDisplayName(b.vendorDriver) : b.driverName,
    unitName: b.vehicle.name,
    title: b.title,
    status: b.status,
    startDate: ymd(b.startDate),
    endDate: ymd(b.endDate),
    callTime: b.callTime,
    location: b.location,
    notes: b.notes,
    leavingFrom: b.workspace.vendor.lotAddress,
    officePhone: b.workspace.vendor.phone,
    acked: b.driverAckedAt ? { at: b.driverAckedAt.toISOString(), note: b.driverAckNote, stale: !!b.logisticsUpdatedAt && b.logisticsUpdatedAt > b.driverAckedAt } : null,
    rolling: b.rollingAt ? { at: b.rollingAt.toISOString(), odometer: b.checkOutOdometer, generator: num(b.checkOutGenerator), notes: b.checkOutNotes } : null,
    back: b.backAt ? { at: b.backAt.toISOString(), odometer: b.checkInOdometer, generator: num(b.checkInGenerator), notes: b.checkInNotes } : null,
    hours: await listHours({ workspaceBookingId: b.id }),
    today: todayPacific(),
    closed: b.status === 'CANCELLED' || b.status === 'RETURNED',
  }
}

export async function bookingByDriverToken(token: string) {
  if (!token || token.length < 32) return null
  return prisma.vendorWorkspaceBooking.findUnique({ where: { driverToken: token }, select: { id: true, status: true, startDate: true, endDate: true } })
}

const meterInt = (v: unknown) => { if (v === undefined || v === null || v === '') return null; const n = Number(String(v).replace(/[,\s]/g, '')); if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error('Odometer must be a number.'), { status: 400 }); return Math.round(n) }
const meterDec = (v: unknown) => { if (v === undefined || v === null || v === '') return null; const n = Number(String(v).replace(/[,\s]/g, '')); if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error('Generator hours must be a number.'), { status: 400 }); return Math.round(n * 10) / 10 }
const note = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 1000) || null : null)

export async function ackDriverBooking(id: string, input: { note?: unknown }): Promise<void> {
  await prisma.vendorWorkspaceBooking.update({ where: { id }, data: { driverAckedAt: new Date(), driverAckNote: note(input.note) } })
}

/** "Rolling": the unit left the lot. Flips a HOLD/CONFIRMED booking to OUT. */
export async function checkOutBooking(id: string, input: { odometer?: unknown; generator?: unknown; notes?: unknown }): Promise<void> {
  const b = await prisma.vendorWorkspaceBooking.findUnique({ where: { id }, select: { status: true } })
  await prisma.vendorWorkspaceBooking.update({
    where: { id },
    data: { rollingAt: new Date(), checkOutOdometer: meterInt(input.odometer), checkOutGenerator: meterDec(input.generator), checkOutNotes: note(input.notes), ...(b && (b.status === 'HOLD' || b.status === 'CONFIRMED') ? { status: 'OUT' } : {}) },
  })
}

/** "Back on the lot": the unit returned. Flips OUT to RETURNED. */
export async function checkInBooking(id: string, input: { odometer?: unknown; generator?: unknown; notes?: unknown }): Promise<void> {
  const b = await prisma.vendorWorkspaceBooking.findUnique({ where: { id }, select: { status: true, checkOutOdometer: true } })
  const odo = meterInt(input.odometer)
  if (odo != null && b?.checkOutOdometer != null && odo < b.checkOutOdometer) throw Object.assign(new Error('Odometer in is lower than the odometer out you entered.'), { status: 400 })
  await prisma.vendorWorkspaceBooking.update({
    where: { id },
    data: { backAt: new Date(), checkInOdometer: odo, checkInGenerator: meterDec(input.generator), checkInNotes: note(input.notes), ...(b?.status === 'OUT' ? { status: 'RETURNED' } : {}) },
  })
}
