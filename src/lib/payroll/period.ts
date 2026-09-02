/**
 * Period assembly — the shape the grid and the CSV both read.
 *
 * One place builds the employee × day matrix and runs the math, so the screen
 * an admin approves and the file ADP receives can never disagree. If you find
 * yourself recomputing totals in a route or a component, call this instead.
 */

import { prisma } from '@/lib/prisma'
import type { PayPeriodStatus, TimeEntrySource } from '@prisma/client'
import { instantToClock } from './clock'
import {
  computeEmployeePeriod, dayHours, findExceptions,
  WORKWEEK_START_DOW,
  type EmployeePeriodTotals, type PayrollException, type TimeEntryInput,
} from './hours'

/** UTC midnight for a Y-M-D, the way @db.Date rows come back. */
export function utcDay(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`)
}

export function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Every calendar day from start to end, inclusive. */
export function eachDay(start: Date, end: Date): Date[] {
  const out: Date[] = []
  const cur = new Date(start)
  while (cur.getTime() <= end.getTime()) {
    out.push(new Date(cur))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

/**
 * The default period offered by "new period": the two Sat–Fri workweeks that
 * most recently completed, relative to `today`.
 *
 * Most recently COMPLETED, not the current one — payroll is keyed from paper
 * sheets after the fact, so the period an admin wants to open is the one the
 * crew just finished, not the one still running.
 */
export function defaultPeriod(today: Date = new Date()): { startDate: Date; endDate: Date } {
  const d = utcDay(toIsoDay(today))
  // Back up to this week's Saturday, then two more weeks.
  const shift = (d.getUTCDay() - WORKWEEK_START_DOW + 7) % 7
  const thisSat = new Date(d)
  thisSat.setUTCDate(thisSat.getUTCDate() - shift)

  const startDate = new Date(thisSat)
  startDate.setUTCDate(startDate.getUTCDate() - 14)
  const endDate = new Date(startDate)
  endDate.setUTCDate(endDate.getUTCDate() + 13)
  return { startDate, endDate }
}

/** One editable cell in the grid. Rates are deliberately absent. */
export interface GridCell {
  id: string
  date: string
  inClock: string | null
  outClock: string | null
  lunchMin: number
  sickHrs: number
  ptoHrs: number
  adjHrs: number
  mealPremium: boolean
  note: string | null
  source: TimeEntrySource
  /** Computed, never stored — the grid shows it, the CSV sums it. */
  workedHrs: number
  spanHrs: number
  incomplete: boolean
}

export interface GridRow {
  employeeId: string
  fullName: string
  title: string | null
  department: string | null
  cells: Record<string, GridCell>
  totals: EmployeePeriodTotals
  exceptions: Array<Omit<PayrollException, 'date'> & { date: string }>
}

export interface PeriodGrid {
  id: string
  startDate: string
  endDate: string
  status: PayPeriodStatus
  note: string | null
  lockedAt: string | null
  exportedAt: string | null
  /** Editable only while DRAFT. The UI reads this rather than re-deriving it. */
  editable: boolean
  days: string[]
  /** Day columns grouped by workweek, so the grid can draw the Sat–Fri break. */
  weeks: Array<{ weekStart: string; days: string[] }>
  rows: GridRow[]
  totals: {
    regHrs: number
    otHrs: number
    dtHrs: number
    sickHrs: number
    ptoHrs: number
    mealPremiumHrs: number
    totalHrs: number
  }
  exceptionCount: number
}

function num(v: unknown): number {
  // Prisma Decimals arrive as Decimal.js instances; Number() is the documented
  // conversion and these values are hours to two places, well inside float.
  return v === null || v === undefined ? 0 : Number(v)
}

/**
 * Load a period and compute everything about it.
 *
 * Roster scope: employees with a PayrollProfile marked onPayroll, PLUS anyone
 * who already has an entry in this period. The second half matters — taking
 * someone off payroll must not silently drop hours they already worked out of
 * a period that was mid-entry.
 */
export async function loadPeriodGrid(periodId: string): Promise<PeriodGrid | null> {
  const period = await prisma.payPeriod.findUnique({
    where: { id: periodId },
    include: {
      entries: {
        include: { employee: { select: { id: true, fullName: true, title: true, department: true } } },
        orderBy: { date: 'asc' },
      },
    },
  })
  if (!period) return null

  const onPayroll = await prisma.employee.findMany({
    where: { payrollProfile: { onPayroll: true } },
    select: { id: true, fullName: true, title: true, department: true },
    orderBy: { fullName: 'asc' },
  })

  const roster = new Map(onPayroll.map((e) => [e.id, e]))
  for (const entry of period.entries) {
    if (!roster.has(entry.employeeId)) roster.set(entry.employeeId, entry.employee)
  }

  const days = eachDay(period.startDate, period.endDate)
  const dayKeys = days.map(toIsoDay)

  const weeks: Array<{ weekStart: string; days: string[] }> = []
  for (const key of dayKeys) {
    const d = utcDay(key)
    const shift = (d.getUTCDay() - WORKWEEK_START_DOW + 7) % 7
    const ws = new Date(d)
    ws.setUTCDate(ws.getUTCDate() - shift)
    const wsKey = toIsoDay(ws)
    const last = weeks[weeks.length - 1]
    if (last && last.weekStart === wsKey) last.days.push(key)
    else weeks.push({ weekStart: wsKey, days: [key] })
  }

  const byEmployee = new Map<string, typeof period.entries>()
  for (const e of period.entries) {
    const bucket = byEmployee.get(e.employeeId)
    if (bucket) bucket.push(e)
    else byEmployee.set(e.employeeId, [e])
  }

  const rows: GridRow[] = [...roster.values()]
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .map((emp) => {
      const entries = byEmployee.get(emp.id) ?? []
      const inputs: TimeEntryInput[] = entries.map((e) => ({
        date: e.date,
        inAt: e.inAt,
        outAt: e.outAt,
        lunchMin: e.lunchMin,
        sickHrs: num(e.sickHrs),
        ptoHrs: num(e.ptoHrs),
        adjHrs: num(e.adjHrs),
        mealPremium: e.mealPremium,
      }))

      const cells: Record<string, GridCell> = {}
      for (const e of entries) {
        const computed = dayHours({
          date: e.date, inAt: e.inAt, outAt: e.outAt, lunchMin: e.lunchMin,
          sickHrs: num(e.sickHrs), ptoHrs: num(e.ptoHrs), adjHrs: num(e.adjHrs),
          mealPremium: e.mealPremium,
        })
        cells[toIsoDay(e.date)] = {
          id: e.id,
          date: toIsoDay(e.date),
          inClock: instantToClock(e.inAt),
          outClock: instantToClock(e.outAt),
          lunchMin: e.lunchMin,
          sickHrs: num(e.sickHrs),
          ptoHrs: num(e.ptoHrs),
          adjHrs: num(e.adjHrs),
          mealPremium: e.mealPremium,
          note: e.note,
          source: e.source,
          workedHrs: computed.workedHrs,
          spanHrs: computed.spanHrs,
          incomplete: computed.incomplete,
        }
      }

      return {
        employeeId: emp.id,
        fullName: emp.fullName,
        title: emp.title,
        department: emp.department,
        cells,
        totals: computeEmployeePeriod(inputs),
        exceptions: findExceptions(inputs.map(dayHours)).map((x) => ({ ...x, date: toIsoDay(x.date) })),
      }
    })

  const sum = (pick: (r: GridRow) => number) =>
    Math.round(rows.reduce((s, r) => s + pick(r), 0) * 100) / 100

  return {
    id: period.id,
    startDate: toIsoDay(period.startDate),
    endDate: toIsoDay(period.endDate),
    status: period.status,
    note: period.note,
    lockedAt: period.lockedAt?.toISOString() ?? null,
    exportedAt: period.exportedAt?.toISOString() ?? null,
    editable: period.status === 'DRAFT',
    days: dayKeys,
    weeks,
    rows,
    totals: {
      regHrs: sum((r) => r.totals.regHrs),
      otHrs: sum((r) => r.totals.otHrs),
      dtHrs: sum((r) => r.totals.dtHrs),
      sickHrs: sum((r) => r.totals.sickHrs),
      ptoHrs: sum((r) => r.totals.ptoHrs),
      mealPremiumHrs: sum((r) => r.totals.mealPremiumHrs),
      totalHrs: sum((r) => r.totals.totalHrs),
    },
    exceptionCount: rows.reduce((s, r) => s + r.exceptions.length, 0),
  }
}
