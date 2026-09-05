/**
 * Driver hours — the Prisma half. The math lives in hoursEntry.ts.
 *
 * One store, two anchors: a partner's driver (SubRental) and a production's
 * driver on our truck (DriverAssignment). Both driver pages post the same
 * body and get the same view back, so the card is one component.
 */
import { prisma } from '@/lib/prisma'
import { computeHours, parseWorkDate, sumHours, workDateInWindow } from '@/lib/drivers/hoursEntry'

export type HoursAnchor = { subRentalId: string } | { driverAssignmentId: string }

export interface HoursEntryView {
  workDate: string
  startTime: string
  endTime: string
  breakMinutes: number
  hours: number
  notes: string | null
  submittedAt: string
}

export interface HoursView {
  entries: HoursEntryView[]
  total: number
}

const toView = (e: {
  workDate: Date
  startTime: string
  endTime: string
  breakMinutes: number
  hours: unknown
  notes: string | null
  submittedAt: Date
}): HoursEntryView => ({
  workDate: e.workDate.toISOString().slice(0, 10),
  startTime: e.startTime,
  endTime: e.endTime,
  breakMinutes: e.breakMinutes,
  hours: Number(String(e.hours)),
  notes: e.notes,
  submittedAt: e.submittedAt.toISOString(),
})

export async function listHours(anchor: HoursAnchor): Promise<HoursView> {
  const rows = await prisma.driverHoursEntry.findMany({
    where: anchor,
    orderBy: { workDate: 'asc' },
  })
  const entries = rows.map(toView)
  return { entries, total: sumHours(entries) }
}

/**
 * One row per day: posting the same date again replaces it. The window is
 * the rental's dates padded a day each side (see workDateInWindow).
 */
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
  const computed = computeHours({
    startTime: String(body.startTime ?? ''),
    endTime: String(body.endTime ?? ''),
    breakMinutes: typeof body.breakMinutes === 'number' ? body.breakMinutes : Number(body.breakMinutes ?? 0),
  })
  if (!computed.ok) return computed
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) || null : null

  const date = new Date(`${workDate}T00:00:00.000Z`)
  const data = {
    startTime: computed.startTime,
    endTime: computed.endTime,
    breakMinutes: computed.breakMinutes,
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
  await prisma.driverHoursEntry.deleteMany({
    where: { ...anchor, workDate: new Date(`${workDate}T00:00:00.000Z`) },
  })
  return listHours(anchor)
}
