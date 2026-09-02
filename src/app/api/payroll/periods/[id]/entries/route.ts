/**
 * One grid cell — upsert or clear.
 *
 * The grid saves per cell rather than per row, because that is how the data
 * arrives: an admin reads one line off the paper sheet and types it. A
 * row-level PUT would make a mid-entry save clobber days they had not gotten
 * to yet.
 *
 * Every write is gated on the period being DRAFT. LOCKED means the numbers
 * were agreed; the fix for a locked period is to unlock it, which is recorded.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePayrollAccess } from '@/lib/payroll/access'
import { instantToClock, punchesFor } from '@/lib/payroll/clock'
import { loadPeriodGrid, toIsoDay, utcDay } from '@/lib/payroll/period'
import type { TimeEntrySource } from '@prisma/client'

export const dynamic = 'force-dynamic'

const SOURCES: TimeEntrySource[] = ['MANUAL', 'PAPER', 'APP', 'OCR']

/** Hours field: absent → undefined (leave alone), null/'' → 0, else a number. */
function hoursField(v: unknown): number | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return 0
  const n = Number(v)
  if (!Number.isFinite(n)) return undefined
  // Two decimal places, and a sane band. A typo'd "800" in a sick-hours box
  // should be rejected, not paid.
  if (Math.abs(n) > 24) return undefined
  return Math.round(n * 100) / 100
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await requirePayrollAccess()
  if (me instanceof NextResponse) return me

  const body = await req.json().catch(() => null)
  if (!body?.employeeId || !body?.date) {
    return NextResponse.json({ error: 'employeeId and date are required' }, { status: 400 })
  }

  const period = await prisma.payPeriod.findUnique({ where: { id: params.id } })
  if (!period) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (period.status !== 'DRAFT') {
    return NextResponse.json({ error: `period is ${period.status} — unlock it to edit` }, { status: 409 })
  }

  const date = utcDay(String(body.date))
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 })
  }
  // A day outside the period would be invisible in the grid and silently
  // absent from the CSV — reject rather than store an orphan.
  if (date < period.startDate || date > period.endDate) {
    return NextResponse.json({
      error: `${toIsoDay(date)} is outside this period (${toIsoDay(period.startDate)} – ${toIsoDay(period.endDate)})`,
    }, { status: 400 })
  }

  const employee = await prisma.employee.findUnique({
    where: { id: String(body.employeeId) }, select: { id: true },
  })
  if (!employee) return NextResponse.json({ error: 'unknown employee' }, { status: 400 })

  const existing = await prisma.timeEntry.findUnique({
    where: {
      employeeId_date_payPeriodId: { employeeId: employee.id, date, payPeriodId: period.id },
    },
  })

  // An explicit clear. Deleting the row rather than zeroing it keeps the grid
  // sparse — an untouched day has no row, which is what "empty cell" means.
  if (body.clear === true) {
    if (existing) await prisma.timeEntry.delete({ where: { id: existing.id } })
    const grid = await loadPeriodGrid(period.id)
    return NextResponse.json(grid)
  }

  const lunchMinRaw = body.lunchMin
  const lunchMin = lunchMinRaw === undefined
    ? undefined
    : Math.min(480, Math.max(0, Math.round(Number(lunchMinRaw) || 0)))

  // Punches are re-derived from the clock strings on every save, because the
  // overnight roll depends on BOTH sides — changing only the out time has to
  // be able to move it across midnight.
  const inClock = body.inClock !== undefined
    ? (body.inClock || null)
    : undefined
  const outClock = body.outClock !== undefined
    ? (body.outClock || null)
    : undefined

  const source: TimeEntrySource = SOURCES.includes(body.source) ? body.source : 'MANUAL'

  if (!existing) {
    const { inAt, outAt } = punchesFor(date, inClock ?? null, outClock ?? null)
    const created = await prisma.timeEntry.create({
      data: {
        payPeriodId: period.id,
        employeeId: employee.id,
        date,
        inAt, outAt,
        lunchMin: lunchMin ?? 30,
        sickHrs: hoursField(body.sickHrs) ?? 0,
        ptoHrs: hoursField(body.ptoHrs) ?? 0,
        adjHrs: hoursField(body.adjHrs) ?? 0,
        mealPremium: Boolean(body.mealPremium),
        note: body.note ? String(body.note) : null,
        source,
        enteredById: me.id,
      },
      select: { id: true },
    })
    void created
  } else {
    // Merge: fields the client did not send keep their stored value, so a
    // lunch-only edit does not wipe the punches.
    const nextIn = inClock !== undefined ? inClock : instantToClock(existing.inAt)
    const nextOut = outClock !== undefined ? outClock : instantToClock(existing.outAt)
    const { inAt, outAt } = punchesFor(date, nextIn, nextOut)

    await prisma.timeEntry.update({
      where: { id: existing.id },
      data: {
        inAt, outAt,
        ...(lunchMin !== undefined ? { lunchMin } : {}),
        ...(hoursField(body.sickHrs) !== undefined ? { sickHrs: hoursField(body.sickHrs) } : {}),
        ...(hoursField(body.ptoHrs) !== undefined ? { ptoHrs: hoursField(body.ptoHrs) } : {}),
        ...(hoursField(body.adjHrs) !== undefined ? { adjHrs: hoursField(body.adjHrs) } : {}),
        ...(body.mealPremium !== undefined ? { mealPremium: Boolean(body.mealPremium) } : {}),
        ...(body.note !== undefined ? { note: body.note ? String(body.note) : null } : {}),
        ...(body.source !== undefined ? { source } : {}),
        enteredById: me.id,
      },
    })
  }

  const grid = await loadPeriodGrid(period.id)
  return NextResponse.json(grid)
}