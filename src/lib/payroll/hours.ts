/**
 * California payroll hour math. Pure, server-side, unit-tested
 * (`npm run test:payroll`). No Prisma, no Date-of-today, no I/O — every
 * input is passed in so the tests can assert on exact numbers.
 *
 * This file decides what SirReel reports to ADP TotalSource. Getting it
 * wrong in one direction underpays crew (a wage claim, and the penalty in
 * California is not small); getting it wrong in the other pays overtime on
 * hours nobody worked. Both directions are covered by the test file — read
 * it before changing anything here.
 *
 * THE RULES, and why each is written the way it is:
 *
 *   Day hours = (out − in) − lunch, with NO lunch deduction when the span is
 *   6 hours or less. The paper sheet assumes a 30-minute unpaid meal on every
 *   row; on a short day no meal was taken and deducting one steals half an
 *   hour. 6h is the threshold SirReel uses (California requires the meal at
 *   5h and permits waiver up to 6h).
 *
 *   Overtime is computed PER WORKWEEK — Saturday through Friday here — never
 *   across the whole two-week period. Averaging two weeks together is the
 *   classic way to under-report: 50h then 30h is 10 hours of OT, not zero.
 *
 *   Within a workweek, three tests run and the largest OT figure wins:
 *     - Daily:  hours past 8 in a day are OT; hours past 12 are double time.
 *     - Weekly: hours past 40 (excluding DT) are OT.
 *   Expressed as: straightCap = Σ min(day, 8) — the hours that can never be
 *   OT under the daily test. DT = Σ max(0, day − 12). Then
 *     OT  = max(total − straightCap − DT, total − DT − 40, 0)
 *     Reg = total − OT − DT
 *   The `max` is what makes the two tests non-additive: an employee who works
 *   five 10-hour days gets 10 hours of daily OT, not 10 + 10.
 *
 *   The 7th-consecutive-day rule (first 8 hours OT, past 8 DT) is NOT
 *   implemented. SirReel's crew does not currently work seven straight days,
 *   and a wrong guess at it is worse than its documented absence. If that
 *   changes, it belongs here — flagged, not silently approximated.
 *
 *   Sick and PTO are paid but are NOT hours worked: they never push anyone
 *   into overtime. They ride their own columns to ADP.
 *
 *   The meal premium is one hour of PAY, not an hour worked — same treatment.
 *   `adjHrs` is a signed correction to worked hours and DOES flow through the
 *   OT math, because that is what an adjustment means.
 */

/** Two decimal places. Payroll hours are quoted to the hundredth. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** The one row the math needs. Decimals are converted by the caller. */
export interface TimeEntryInput {
  /** Calendar date the shift STARTED. Used to bucket into a workweek. */
  date: Date
  inAt?: Date | null
  outAt?: Date | null
  /** Unpaid meal minutes. Ignored on spans of 6h or less. */
  lunchMin?: number | null
  sickHrs?: number | null
  ptoHrs?: number | null
  /** Signed correction to worked hours. */
  adjHrs?: number | null
  mealPremium?: boolean | null
}

export interface DayResult {
  date: Date
  /** Raw out − in, before the meal deduction. 0 when either punch is missing. */
  spanHrs: number
  /** Meal minutes actually deducted — 0 when the span is 6h or less. */
  lunchApplied: number
  /** Hours worked: span − lunch + adj. This is what the OT math consumes. */
  workedHrs: number
  sickHrs: number
  ptoHrs: number
  adjHrs: number
  mealPremium: boolean
  /** True when the punches are unusable (one side missing, or out ≤ in). */
  incomplete: boolean
}

/**
 * Hours for a single day.
 *
 * outAt is an instant, so a shift that ends after midnight is simply a later
 * timestamp — no wrap-around guessing. An outAt at or before inAt is treated
 * as unusable rather than negative; the grid surfaces it as incomplete and an
 * admin fixes the entry.
 */
export function dayHours(entry: TimeEntryInput): DayResult {
  const sickHrs = round2(entry.sickHrs ?? 0)
  const ptoHrs = round2(entry.ptoHrs ?? 0)
  const adjHrs = round2(entry.adjHrs ?? 0)
  const mealPremium = Boolean(entry.mealPremium)

  const base = {
    date: entry.date,
    sickHrs,
    ptoHrs,
    adjHrs,
    mealPremium,
  }

  if (!entry.inAt || !entry.outAt) {
    // No punches is NOT an error — a sick day or a PTO day is a legitimate
    // row with no clock times. It is only "incomplete" if exactly one side
    // was entered, which means someone started typing and stopped.
    const halfEntered = Boolean(entry.inAt) !== Boolean(entry.outAt)
    return {
      ...base,
      spanHrs: 0,
      lunchApplied: 0,
      workedHrs: round2(adjHrs),
      incomplete: halfEntered,
    }
  }

  const spanMs = entry.outAt.getTime() - entry.inAt.getTime()
  if (spanMs <= 0) {
    return { ...base, spanHrs: 0, lunchApplied: 0, workedHrs: round2(adjHrs), incomplete: true }
  }

  const spanHrs = round2(spanMs / 3_600_000)
  // The short-day rule: a span of exactly 6h still gets no deduction.
  const lunchApplied = spanHrs <= 6 ? 0 : Math.max(0, entry.lunchMin ?? 30)
  const worked = spanHrs - lunchApplied / 60 + adjHrs

  return {
    ...base,
    spanHrs,
    lunchApplied,
    // A lunch longer than the span (or a big negative adjustment) must not
    // report negative hours worked.
    workedHrs: round2(Math.max(0, worked)),
    incomplete: false,
  }
}

export interface WeekTotals {
  /** Sat-anchored first day of this workweek. */
  weekStart: Date
  /** Total hours WORKED (excludes sick/PTO/meal premium). */
  totalHrs: number
  regHrs: number
  otHrs: number
  dtHrs: number
  sickHrs: number
  ptoHrs: number
  /** One hour per flagged entry. Pay, not time worked. */
  mealPremiumHrs: number
  days: DayResult[]
}

/**
 * The California split for ONE workweek. Callers must not hand this days from
 * two different weeks — use `splitIntoWorkweeks`.
 */
export function weekSplit(days: DayResult[], weekStart: Date): WeekTotals {
  const total = round2(days.reduce((s, d) => s + d.workedHrs, 0))

  // Hours immune to the daily test — the first 8 of each day.
  const straightCap = round2(days.reduce((s, d) => s + Math.min(d.workedHrs, 8), 0))
  // Double time: past 12 in a single day.
  const dt = round2(days.reduce((s, d) => s + Math.max(0, d.workedHrs - 12), 0))

  const dailyOt = total - straightCap - dt
  const weeklyOt = total - dt - 40
  const ot = round2(Math.max(dailyOt, weeklyOt, 0))
  const reg = round2(total - ot - dt)

  return {
    weekStart,
    totalHrs: total,
    regHrs: reg,
    otHrs: ot,
    dtHrs: dt,
    sickHrs: round2(days.reduce((s, d) => s + d.sickHrs, 0)),
    ptoHrs: round2(days.reduce((s, d) => s + d.ptoHrs, 0)),
    mealPremiumHrs: round2(days.filter((d) => d.mealPremium).length),
    days,
  }
}

/** Saturday. SirReel's workweek runs Sat → Fri, matching the paper sheet. */
export const WORKWEEK_START_DOW = 6

/**
 * UTC midnight of the Saturday on or before `date`.
 *
 * UTC throughout, deliberately: `TimeEntry.date` is a @db.Date stored at UTC
 * midnight, and reading it with local getters rolls it back a day west of
 * Greenwich — the exact bug documented in src/lib/dates/calendarDate.ts.
 */
export function workweekStart(date: Date, startDow: number = WORKWEEK_START_DOW): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const shift = (d.getUTCDay() - startDow + 7) % 7
  d.setUTCDate(d.getUTCDate() - shift)
  return d
}

/** Group days into workweeks, ordered oldest first. */
export function splitIntoWorkweeks(
  days: DayResult[],
  startDow: number = WORKWEEK_START_DOW,
): Map<string, DayResult[]> {
  const byWeek = new Map<string, DayResult[]>()
  for (const d of days) {
    const key = workweekStart(d.date, startDow).toISOString().slice(0, 10)
    const bucket = byWeek.get(key)
    if (bucket) bucket.push(d)
    else byWeek.set(key, [d])
  }
  return new Map([...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

export interface EmployeePeriodTotals {
  weeks: WeekTotals[]
  /** Period-wide sums. Present for the totals row; ADP is fed per week. */
  totalHrs: number
  regHrs: number
  otHrs: number
  dtHrs: number
  sickHrs: number
  ptoHrs: number
  mealPremiumHrs: number
}

/**
 * Everything one employee's period comes to. Entries may span both weeks;
 * they are bucketed and split per week before being summed, which is the
 * whole point — see the header.
 */
export function computeEmployeePeriod(
  entries: TimeEntryInput[],
  startDow: number = WORKWEEK_START_DOW,
): EmployeePeriodTotals {
  const days = entries
    .map(dayHours)
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  const weeks: WeekTotals[] = []
  for (const [key, bucket] of splitIntoWorkweeks(days, startDow)) {
    weeks.push(weekSplit(bucket, new Date(`${key}T00:00:00.000Z`)))
  }

  const sum = (pick: (w: WeekTotals) => number) => round2(weeks.reduce((s, w) => s + pick(w), 0))

  return {
    weeks,
    totalHrs: sum((w) => w.totalHrs),
    regHrs: sum((w) => w.regHrs),
    otHrs: sum((w) => w.otHrs),
    dtHrs: sum((w) => w.dtHrs),
    sickHrs: sum((w) => w.sickHrs),
    ptoHrs: sum((w) => w.ptoHrs),
    mealPremiumHrs: sum((w) => w.mealPremiumHrs),
  }
}

// ---------------------------------------------------------------------------
// Exceptions — the strip above the grid.
//
// These are the rows an admin must look at before locking a period. They are
// not errors; they are the things that, on the paper process, were caught by
// somebody noticing. Surfacing them is the point of doing this in HQ at all.
// ---------------------------------------------------------------------------

export type PayrollExceptionKind =
  | 'meal-premium'
  | 'adjustment'
  | 'long-day'
  | 'incomplete-punch'

export interface PayrollException {
  kind: PayrollExceptionKind
  date: Date
  detail: string
}

/** Days over 12h are double-time territory — worth a second look. */
export const LONG_DAY_HRS = 12

export function findExceptions(days: DayResult[]): PayrollException[] {
  const out: PayrollException[] = []
  for (const d of days) {
    if (d.mealPremium) {
      out.push({ kind: 'meal-premium', date: d.date, detail: '1.0 hr meal premium' })
    }
    if (d.adjHrs !== 0) {
      out.push({
        kind: 'adjustment',
        date: d.date,
        detail: `${d.adjHrs > 0 ? '+' : ''}${d.adjHrs.toFixed(2)} hr adjustment`,
      })
    }
    if (d.workedHrs > LONG_DAY_HRS) {
      out.push({
        kind: 'long-day',
        date: d.date,
        detail: `${d.workedHrs.toFixed(2)} hrs — ${round2(d.workedHrs - LONG_DAY_HRS).toFixed(2)} at double time`,
      })
    }
    if (d.incomplete) {
      out.push({ kind: 'incomplete-punch', date: d.date, detail: 'in/out incomplete' })
    }
  }
  return out
}
