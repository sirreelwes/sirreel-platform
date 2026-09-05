/**
 * Driver hours — the Prisma half. The math lives in hoursEntry.ts.
 *
 * One store, two anchors: a partner's driver (SubRental) and a production's
 * driver on our truck (DriverAssignment). Both driver pages post the same
 * body — a work date and up to four stamps — and get the same view back, so
 * the card is one component. Re-posting a day replaces it, which is how a
 * driver adds "wrap" at night to the "left lot" they logged at dawn.
 */
import { prisma } from '@/lib/prisma'
import { computePortalHours, parseWorkDate, sumHours, workDateInWindow } from '@/lib/drivers/hoursEntry'

export type HoursAnchor = { subRentalId: string } | { driverAssignmentId: string }

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
  submittedAt: string
}

export interface HoursView {
  entries: HoursEntryView[]
  total: number
  /** Days logged with no wrap yet. */
  open: number
}

const toView = (e: {
  workDate: Date
  startTime: string
  onSetTime: string | null
  leftSetTime: string | null
  endTime: string | null
  hours: unknown
  notes: string | null
  submittedAt: Date
}): HoursEntryView => ({
  workDate: e.workDate.toISOString().slice(0, 10),
  startTime: e.startTime,
  onSetTime: e.onSetTime,
  leftSetTime: e.leftSetTime,
  endTime: e.endTime,
  hours: e.hours === null || e.hours === undefined ? null : Number(String(e.hours)),
  notes: e.notes,
  submittedAt: e.submittedAt.toISOString(),
})

export async function listHours(anchor: HoursAnchor): Promise<HoursView> {
  const rows = await prisma.driverHoursEntry.findMany({ where: anchor, orderBy: { workDate: 'asc' } })
  const entries = rows.map(toView)
  return { entries, total: sumHours(entries), open: entries.filter((e) => e.hours === null).length }
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

  const date = new Date(`${workDate}T00:00:00.000Z`)
  const data = {
    startTime: computed.startTime,
    onSetTime: computed.onSetTime,
    leftSetTime: computed.leftSetTime,
    endTime: computed.endTime,
    breakMinutes: 0,
    hours: computed.hours,
    notes,
    submittedAt: new Date(),
  }
  if ('subRentalId' in anchor) {
    await prisma.driverHoursEntry.upsert({
      where: { subRentalId_workDate: { subRentalId: anchor.subRentalId, workDate: date } },
      update: data,
      create: { ...data, subRentalId: anchor.subRentalId, workDate: date },
    })
  } else {
    await prisma.driverHoursEntry.upsert({
      where: { driverAssignmentId_workDate: { driverAssignmentId: anchor.driverAssignmentId, workDate: date } },
      update: data,
      create: { ...data, driverAssignmentId: anchor.driverAssignmentId, workDate: date },
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
