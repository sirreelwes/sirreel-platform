/**
 * Driver hours — the Prisma half. The math lives in hoursEntry.ts.
 *
 * One store, three anchors: a partner's driver (SubRental), a production's
 * driver on our truck (DriverAssignment), and a partner's own booking in
 * their Utliiz workspace (VendorWorkspaceBooking). Every driver page posts
 * the same body — a work date, up to four stamps, and the meters — and gets
 * the same view back, so the card is one component. Re-posting a day
 * replaces it, which is how a driver adds "wrap" at night to the "left lot"
 * they logged at dawn.
 *
 * METERS (Wes 2026-09-06): the partner's fee schedule bills mileage per
 * mile, generator per hour and supplies per day on top of the driver's
 * shift, and nobody but the driver knows the numbers. So the day carries
 * odometer out/in, generator hours out/in and a supplies line; miles and
 * generator hours are derived here, never stored.
 */
import { prisma } from '@/lib/prisma'
import { computePortalHours, parseWorkDate, sumHours, workDateInWindow } from '@/lib/drivers/hoursEntry'

export type HoursAnchor = { subRentalId: string } | { driverAssignmentId: string } | { workspaceBookingId: string }

export interface HoursEntryView {
  workDate: string
  /** Left lot. */
  startTime: string
  onSetTime: string | null
  leftSetTime: string | null
  /** Wrap. Null while the day is still open. */
  endTime: string | null
  /** Portal to portal; null until wrap. */
  hours: number | null
  notes: string | null
  /** Meters — null when the driver didn't enter them. */
  odometerOut: number | null
  odometerIn: number | null
  /** in − out, when both are known. */
  miles: number | null
  generatorHoursOut: number | null
  generatorHoursIn: number | null
  generatorHours: number | null
  suppliesNote: string | null
  submittedAt: string
}

export interface HoursView {
  entries: HoursEntryView[]
  total: number
  /** Days logged with no wrap yet. */
  open: number
  /** Metered usage across every day, for the fee lines. */
  usage: { miles: number; generatorHours: number; daysWithSupplies: number }
}

const toView = (e: {
  workDate: Date
  startTime: string
  onSetTime: string | null
  leftSetTime: string | null
  endTime: string | null
  hours: unknown
  notes: string | null
  odometerOut: number | null
  odometerIn: number | null
  generatorHoursOut: unknown
  generatorHoursIn: unknown
  suppliesNote: string | null
  submittedAt: Date
}): HoursEntryView => {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(String(v)))
  const gOut = num(e.generatorHoursOut), gIn = num(e.generatorHoursIn)
  return {
    workDate: e.workDate.toISOString().slice(0, 10),
    startTime: e.startTime,
    onSetTime: e.onSetTime,
    leftSetTime: e.leftSetTime,
    endTime: e.endTime,
    hours: num(e.hours),
    notes: e.notes,
    odometerOut: e.odometerOut,
    odometerIn: e.odometerIn,
    miles: e.odometerOut != null && e.odometerIn != null && e.odometerIn >= e.odometerOut ? e.odometerIn - e.odometerOut : null,
    generatorHoursOut: gOut,
    generatorHoursIn: gIn,
    generatorHours: gOut != null && gIn != null && gIn >= gOut ? Math.round((gIn - gOut) * 10) / 10 : null,
    suppliesNote: e.suppliesNote,
    submittedAt: e.submittedAt.toISOString(),
  }
}

function usageOf(entries: HoursEntryView[]): HoursView['usage'] {
  return {
    miles: entries.reduce((n, e) => n + (e.miles ?? 0), 0),
    generatorHours: Math.round(entries.reduce((n, e) => n + (e.generatorHours ?? 0), 0) * 10) / 10,
    daysWithSupplies: entries.filter((e) => !!e.suppliesNote).length,
  }
}

/**
 * Usage totals from raw rows — for readers that select DriverHoursEntry
 * themselves (the job's sub-rental panel, the partner-fee route) rather
 * than going through listHours. Same derivation as the view.
 */
export function usageOfRows(rows: Array<{ odometerOut: number | null; odometerIn: number | null; generatorHoursOut: unknown; generatorHoursIn: unknown; suppliesNote: string | null }>): HoursView['usage'] {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(String(v)))
  let miles = 0, gen = 0, supplies = 0
  for (const r of rows) {
    if (r.odometerOut != null && r.odometerIn != null && r.odometerIn >= r.odometerOut) miles += r.odometerIn - r.odometerOut
    const gOut = num(r.generatorHoursOut), gIn = num(r.generatorHoursIn)
    if (gOut != null && gIn != null && gIn >= gOut) gen += gIn - gOut
    if (r.suppliesNote) supplies += 1
  }
  return { miles, generatorHours: Math.round(gen * 10) / 10, daysWithSupplies: supplies }
}

export async function listHours(anchor: HoursAnchor): Promise<HoursView> {
  const rows = await prisma.driverHoursEntry.findMany({ where: anchor, orderBy: { workDate: 'asc' } })
  const entries = rows.map(toView)
  return { entries, total: sumHours(entries), open: entries.filter((e) => e.hours === null).length, usage: usageOf(entries) }
}

export async function upsertHours(
  anchor: HoursAnchor,
  body: Record<string, unknown>,
  window: { startDate: string | null; endDate: string | null },
): Promise<{ ok: true; view: HoursView } | { ok: false; error: string }> {
  const workDate = parseWorkDate(body.workDate)
  if (!workDate) return { ok: false, error: 'Pick the day you worked.' }
  if (!workDateInWindow(workDate, window)) {
    return { ok: false, error: 'That day is outside this job’s dates. If it’s right, tell SirReel.' }
  }
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : null)
  const computed = computePortalHours({ leftLot: str('leftLot') ?? '', onSet: str('onSet'), leftSet: str('leftSet'), wrap: str('wrap') })
  if (!computed.ok) return computed
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) || null : null
  // Meters. Blank = not entered; a number that isn't one = refused, because a
  // wrong odometer becomes a wrong mileage line on the client's invoice.
  const meter = (k: string, kind: 'int' | 'dec'): number | null | { error: string } => {
    const v = body[k]
    if (v === undefined || v === null || v === '') return null
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''))
    if (!Number.isFinite(n) || n < 0) return { error: `${k.replace(/([A-Z])/g, ' $1').toLowerCase()} must be a number.` }
    return kind === 'int' ? Math.round(n) : Math.round(n * 10) / 10
  }
  const meters = { odometerOut: meter('odometerOut', 'int'), odometerIn: meter('odometerIn', 'int'), generatorHoursOut: meter('generatorHoursOut', 'dec'), generatorHoursIn: meter('generatorHoursIn', 'dec') }
  for (const v of Object.values(meters)) if (v && typeof v === 'object') return { ok: false, error: v.error }
  const m = meters as Record<keyof typeof meters, number | null>
  if (m.odometerOut != null && m.odometerIn != null && m.odometerIn < m.odometerOut) return { ok: false, error: 'Odometer in is lower than odometer out.' }
  if (m.generatorHoursOut != null && m.generatorHoursIn != null && m.generatorHoursIn < m.generatorHoursOut) return { ok: false, error: 'Generator hours in are lower than out.' }
  const suppliesNote = typeof body.suppliesNote === 'string' ? body.suppliesNote.trim().slice(0, 500) || null : null

  const date = new Date(`${workDate}T00:00:00.000Z`)
  const data = {
    startTime: computed.startTime,
    onSetTime: computed.onSetTime,
    leftSetTime: computed.leftSetTime,
    endTime: computed.endTime,
    breakMinutes: 0,
    hours: computed.hours,
    notes,
    odometerOut: m.odometerOut,
    odometerIn: m.odometerIn,
    generatorHoursOut: m.generatorHoursOut,
    generatorHoursIn: m.generatorHoursIn,
    suppliesNote,
    submittedAt: new Date(),
  }
  if ('subRentalId' in anchor) {
    await prisma.driverHoursEntry.upsert({
      where: { subRentalId_workDate: { subRentalId: anchor.subRentalId, workDate: date } },
      update: data,
      create: { ...data, subRentalId: anchor.subRentalId, workDate: date },
    })
  } else if ('driverAssignmentId' in anchor) {
    await prisma.driverHoursEntry.upsert({
      where: { driverAssignmentId_workDate: { driverAssignmentId: anchor.driverAssignmentId, workDate: date } },
      update: data,
      create: { ...data, driverAssignmentId: anchor.driverAssignmentId, workDate: date },
    })
  } else {
    await prisma.driverHoursEntry.upsert({
      where: { workspaceBookingId_workDate: { workspaceBookingId: anchor.workspaceBookingId, workDate: date } },
      update: data,
      create: { ...data, workspaceBookingId: anchor.workspaceBookingId, workDate: date },
    })
  }
  return { ok: true, view: await listHours(anchor) }
}

export async function deleteHours(anchor: HoursAnchor, workDateRaw: unknown): Promise<HoursView | null> {
  const workDate = parseWorkDate(workDateRaw)
  if (!workDate) return null
  await prisma.driverHoursEntry.deleteMany({ where: { ...anchor, workDate: new Date(`${workDate}T00:00:00.000Z`) } })
  return listHours(anchor)
}
