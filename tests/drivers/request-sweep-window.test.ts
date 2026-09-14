/**
 * The 48-hour driver-request window, at its edges.
 *
 * Wes 2026-09-14: "48 hours before the shoot we should send out a
 * request for a driver if they haven't already uploaded one."
 *
 * "48 hours" is implemented as Pacific CALENDAR DAYS, inclusive on both
 * ends — a job starting today, tomorrow or the day after is inside the
 * window. The temptation is to write it as `start - now <= 48h`, which
 * is wrong in two directions at once: a 9am run would miss a job that
 * starts at 8am two days out, and it reads the @db.Date start (UTC
 * midnight) as a real instant, so every Pacific afternoon shifts the
 * answer by a day. This repo has already paid for an off-by-one on
 * inclusive date spans once; this pins it.
 *
 * Run: npm run test:driver-sweep-window
 */
import { sweepWindow, SWEEP_WINDOW_DAYS, SWEEP_SUPPRESS_DAYS } from '../../src/lib/drivers/driverRequestSweep'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = got === want
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${got}${ok ? '' : ` (want ${want})`}`)
}

// The cron fires at 16:00 UTC = 9am PDT.
console.log('Morning run (9am PDT, Sep 14):')
const morning = sweepWindow(new Date('2026-09-14T16:00:00Z'))
eq('  today  ', morning.today, '2026-09-14')
eq('  through', morning.through, '2026-09-16')

// The UTC date has already rolled over; the Pacific one has not. Reading
// the clock in UTC here would ask a day early for every job.
console.log('\nLate Pacific evening (11pm PDT, Sep 14 = 06:00 UTC Sep 15):')
const evening = sweepWindow(new Date('2026-09-15T06:00:00Z'))
eq('  today  ', evening.today, '2026-09-14')
eq('  through', evening.through, '2026-09-16')

console.log('\nMonth boundary (Sep 30 → Oct 2):')
const monthEnd = sweepWindow(new Date('2026-09-30T16:00:00Z'))
eq('  today  ', monthEnd.today, '2026-09-30')
eq('  through', monthEnd.through, '2026-10-02')

console.log('\nStandard time (Dec 1, 8am PST):')
const winter = sweepWindow(new Date('2026-12-01T16:00:00Z'))
eq('  today  ', winter.today, '2026-12-01')
eq('  through', winter.through, '2026-12-03')

console.log('\nInvariants:')
// Inclusive on both ends: today + 2 more days = 3 days of coverage.
const days = (w: { today: string; through: string }) =>
  Math.round((Date.parse(`${w.through}T00:00:00Z`) - Date.parse(`${w.today}T00:00:00Z`)) / 86400000) + 1
eq('window covers 3 calendar days', days(morning), SWEEP_WINDOW_DAYS + 1)
eq('  ...across a month boundary ', days(monthEnd), SWEEP_WINDOW_DAYS + 1)
// Suppression must outlast the window, or a job sitting inside the
// window gets asked again on each daily run until it starts.
eq('suppression outlasts window', SWEEP_SUPPRESS_DAYS > SWEEP_WINDOW_DAYS, true)

console.log(fail === 0 ? '\nAll passed.' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
