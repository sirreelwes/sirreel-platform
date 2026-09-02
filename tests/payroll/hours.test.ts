/**
 * California payroll hour math.
 *
 *   npm run test:payroll
 *
 * Pure + offline. Every case below is a shape SirReel's paper timesheets
 * actually produce — a 12-hour shoot day, a half-day pickup, a night shoot
 * that crosses midnight, a week that trips the weekly test but not the daily
 * one (and the reverse).
 *
 * The asymmetry that drives the coverage: under-reporting OT is a wage claim
 * with California penalties attached; over-reporting is money out the door on
 * hours nobody worked. Both directions get explicit tests.
 */

import {
  dayHours, weekSplit, computeEmployeePeriod, workweekStart, splitIntoWorkweeks,
  findExceptions, round2,
  type TimeEntryInput, type DayResult,
} from '../../src/lib/payroll/hours'

const failures: string[] = []
const check = (c: boolean, why: string) => {
  console.log(c ? `  ok — ${why}` : `  FAIL — ${why}`)
  if (!c) failures.push(why)
}

/** A day at UTC midnight, the way @db.Date rows come back. */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
/** A clock time on a given day, in UTC — the tests never depend on a zone. */
const at = (iso: string, hh: number, mm = 0) =>
  new Date(`${iso}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`)

const entry = (over: Partial<TimeEntryInput> & { date: Date }): TimeEntryInput => ({
  lunchMin: 30, sickHrs: 0, ptoHrs: 0, adjHrs: 0, mealPremium: false, ...over,
})

/** A worked day of exactly `hrs`, lunch already accounted for. */
const worked = (iso: string, hrs: number): TimeEntryInput => {
  const spanHrs = hrs > 6 ? hrs + 0.5 : hrs // add the lunch back when it applies
  return entry({ date: day(iso), inAt: at(iso, 8), outAt: new Date(at(iso, 8).getTime() + spanHrs * 3_600_000) })
}

console.log('\nDay hours — the meal deduction')
check(dayHours(entry({ date: day('2026-08-17'), inAt: at('2026-08-17', 8), outAt: at('2026-08-17', 17) })).workedHrs === 8.5,
  '8a–5p with a 30-min lunch is 8.5 hrs')
check(dayHours(entry({ date: day('2026-08-17'), inAt: at('2026-08-17', 8), outAt: at('2026-08-17', 14) })).workedHrs === 6,
  'a 6-hour span takes NO lunch deduction — deducting one steals half an hour off a short day')
check(dayHours(entry({ date: day('2026-08-17'), inAt: at('2026-08-17', 8), outAt: at('2026-08-17', 14) })).lunchApplied === 0,
  'and it reports lunchApplied 0, so the grid can show why')
check(dayHours(entry({ date: day('2026-08-17'), inAt: at('2026-08-17', 8), outAt: at('2026-08-17', 14, 30) })).workedHrs === 6,
  'just past 6h (6.5 span) crosses the threshold — 6.5 − 0.5 = 6.0')
check(dayHours(entry({ date: day('2026-08-17'), inAt: at('2026-08-17', 8), outAt: at('2026-08-17', 17), lunchMin: 60 })).workedHrs === 8,
  'a 60-minute lunch is honored when entered')
check(dayHours(entry({ date: day('2026-08-17'), inAt: at('2026-08-17', 8), outAt: at('2026-08-17', 17), lunchMin: 0 })).workedHrs === 9,
  'a 0-minute lunch means none was taken')

console.log('\nDay hours — night shoots and bad punches')
check(dayHours(entry({ date: day('2026-08-17'), inAt: at('2026-08-17', 14), outAt: at('2026-08-18', 2) })).workedHrs === 11.5,
  '2p to 2a the NEXT day is a 12-hour span, 11.5 worked — crossing midnight is not a wrap-around guess')
check(dayHours(entry({ date: day('2026-08-17'), inAt: at('2026-08-17', 14), outAt: at('2026-08-18', 2) })).date.getTime() === day('2026-08-17').getTime(),
  'and the day it belongs to is the day the shift STARTED, matching the paper column')
check(dayHours(entry({ date: day('2026-08-17'), inAt: at('2026-08-17', 8), outAt: at('2026-08-17', 8) })).incomplete,
  'out === in is flagged incomplete, not reported as 0 hours worked silently')
check(dayHours(entry({ date: day('2026-08-17'), inAt: at('2026-08-17', 17), outAt: at('2026-08-17', 8) })).incomplete,
  'out BEFORE in is incomplete — never a negative day')
check(dayHours(entry({ date: day('2026-08-17'), inAt: at('2026-08-17', 8) })).incomplete,
  'an in with no out is incomplete — someone started typing and stopped')
check(!dayHours(entry({ date: day('2026-08-17'), sickHrs: 8 })).incomplete,
  'but a sick day with NO punches at all is legitimate, not incomplete')

console.log('\nDay hours — sick, PTO, adjustments')
const sickDay = dayHours(entry({ date: day('2026-08-17'), sickHrs: 8 }))
check(sickDay.sickHrs === 8 && sickDay.workedHrs === 0,
  'sick hours are carried but are NOT hours worked — they must never create overtime')
check(dayHours(entry({ date: day('2026-08-17'), ptoHrs: 8 })).workedHrs === 0,
  'same for PTO')
check(dayHours(entry({ date: day('2026-08-17'), inAt: at('2026-08-17', 8), outAt: at('2026-08-17', 17), adjHrs: 0.5 })).workedHrs === 9,
  'a positive adjustment DOES flow into hours worked — that is what an adjustment means')
check(dayHours(entry({ date: day('2026-08-17'), inAt: at('2026-08-17', 8), outAt: at('2026-08-17', 17), adjHrs: -1 })).workedHrs === 7.5,
  'and a negative one subtracts')
check(dayHours(entry({ date: day('2026-08-17'), inAt: at('2026-08-17', 8), outAt: at('2026-08-17', 17), adjHrs: -20 })).workedHrs === 0,
  'an over-large negative adjustment floors at 0, never negative hours')
const mp = dayHours(entry({ date: day('2026-08-17'), inAt: at('2026-08-17', 8), outAt: at('2026-08-17', 17), mealPremium: true }))
check(mp.mealPremium && mp.workedHrs === 8.5,
  'the meal premium is flagged but adds NO hours worked — it is an hour of pay, not time')

console.log('\nWeek split — the daily test')
const wk = (days: TimeEntryInput[]) => weekSplit(days.map(dayHours), day('2026-08-15'))
let w = wk([worked('2026-08-17', 10), worked('2026-08-18', 10), worked('2026-08-19', 10)])
check(w.totalHrs === 30 && w.regHrs === 24 && w.otHrs === 6 && w.dtHrs === 0,
  'three 10-hour days = 24 reg + 6 OT, even though the week never reaches 40')
w = wk([worked('2026-08-17', 8), worked('2026-08-18', 8)])
check(w.otHrs === 0 && w.regHrs === 16, 'two clean 8s produce no overtime at all')
w = wk([worked('2026-08-17', 14)])
check(w.dtHrs === 2 && w.otHrs === 4 && w.regHrs === 8,
  'a single 14-hour day is 8 reg + 4 OT + 2 double time')
w = wk([worked('2026-08-17', 12)])
check(w.dtHrs === 0 && w.otHrs === 4, 'exactly 12 hours is all OT, no double time yet')

console.log('\nWeek split — the weekly test, and that the two do not stack')
w = wk([worked('2026-08-17', 8), worked('2026-08-18', 8), worked('2026-08-19', 8), worked('2026-08-20', 8), worked('2026-08-21', 8), worked('2026-08-22', 8)])
check(w.totalHrs === 48 && w.regHrs === 40 && w.otHrs === 8,
  'six 8-hour days = 40 reg + 8 OT (weekly test fires, daily test does not)')
w = wk([worked('2026-08-17', 10), worked('2026-08-18', 10), worked('2026-08-19', 10), worked('2026-08-20', 10), worked('2026-08-21', 10)])
check(w.totalHrs === 50 && w.otHrs === 10 && w.regHrs === 40,
  'five 10-hour days is 10 hrs of OT — NOT 20. The daily and weekly tests take the max, they do not add')
w = wk([worked('2026-08-17', 13), worked('2026-08-18', 13), worked('2026-08-19', 13), worked('2026-08-20', 13)])
check(w.totalHrs === 52 && w.dtHrs === 4 && w.otHrs === 16 && w.regHrs === 32,
  'four 13-hour days: 4 DT, then the daily test gives 16 OT — the weekly test (52−4−40=8) loses')
check(round2(w.regHrs + w.otHrs + w.dtHrs) === w.totalHrs,
  'and reg + OT + DT always reconciles back to total hours worked')

console.log('\nWeek split — sick and PTO never create overtime')
w = wk([worked('2026-08-17', 8), worked('2026-08-18', 8), worked('2026-08-19', 8), worked('2026-08-20', 8), worked('2026-08-21', 8), entry({ date: day('2026-08-22'), sickHrs: 8 })])
check(w.totalHrs === 40 && w.otHrs === 0 && w.sickHrs === 8,
  'a 40-hour week plus an 8-hour sick day is 40 reg + 8 sick — NOT 8 hours of overtime')
w = wk([worked('2026-08-17', 8), entry({ date: day('2026-08-18'), ptoHrs: 8, mealPremium: true })])
check(w.mealPremiumHrs === 1, 'meal premiums count 1.0 hr each, on their own line')

console.log('\nWorkweeks — Saturday anchored, and the period must not average them')
check(workweekStart(day('2026-08-15')).toISOString().slice(0, 10) === '2026-08-15',
  'Sat Aug 15 is its own week start')
check(workweekStart(day('2026-08-21')).toISOString().slice(0, 10) === '2026-08-15',
  'Fri Aug 21 belongs to the Aug 15 week (Sat–Fri)')
check(workweekStart(day('2026-08-22')).toISOString().slice(0, 10) === '2026-08-22',
  'Sat Aug 22 starts the NEXT week')
check(splitIntoWorkweeks([worked('2026-08-17', 8), worked('2026-08-24', 8)].map(dayHours)).size === 2,
  'entries from two weeks bucket into two workweeks')

const period = computeEmployeePeriod([
  // Week 1 — 50 hours: 10 hrs OT.
  worked('2026-08-17', 10), worked('2026-08-18', 10), worked('2026-08-19', 10),
  worked('2026-08-20', 10), worked('2026-08-21', 10),
  // Week 2 — 30 hours: none.
  worked('2026-08-24', 10), worked('2026-08-25', 10), worked('2026-08-26', 10),
])
check(period.weeks.length === 2, 'a two-week period splits into two workweeks')
check(period.otHrs === 16,
  'a 50-hour week (10 OT) then a 30-hour week of 10s (6 OT) is 16 hrs OT — averaging the period to 40/wk would report ZERO')
check(period.weeks[0].otHrs === 10 && period.weeks[1].otHrs === 6,
  'and each week reports its own OT, which is what ADP is fed')
check(period.weeks[1].totalHrs === 30 && period.weeks[1].regHrs === 24,
  'the short week still owes daily OT on its 10-hour days — 30 hrs is not 30 hrs of straight time')

console.log('\nExceptions strip')
const days: DayResult[] = [
  dayHours(entry({ date: day('2026-08-17'), inAt: at('2026-08-17', 6), outAt: at('2026-08-17', 21), mealPremium: true })),
  dayHours(entry({ date: day('2026-08-18'), inAt: at('2026-08-18', 8), outAt: at('2026-08-18', 17), adjHrs: -1.5 })),
  dayHours(entry({ date: day('2026-08-19'), inAt: at('2026-08-19', 8) })),
  dayHours(entry({ date: day('2026-08-20'), inAt: at('2026-08-20', 8), outAt: at('2026-08-20', 17) })),
]
const ex = findExceptions(days)
check(ex.some((e) => e.kind === 'meal-premium'), 'a meal premium is surfaced')
check(ex.some((e) => e.kind === 'adjustment' && e.detail.includes('-1.50')), 'a nonzero adjustment is surfaced with its signed value — a silent adjustment is not possible')
check(ex.some((e) => e.kind === 'long-day'), 'a 14.5-hour day is surfaced')
check(ex.some((e) => e.kind === 'incomplete-punch'), 'a half-entered punch is surfaced')
check(!ex.some((e) => e.date.getTime() === day('2026-08-20').getTime()),
  'and an ordinary 8:30 day raises nothing — the strip stays short enough to read')

console.log(failures.length ? `\n${failures.length} FAILED\n` : '\nAll payroll hour tests passed\n')
process.exit(failures.length ? 1 : 0)
