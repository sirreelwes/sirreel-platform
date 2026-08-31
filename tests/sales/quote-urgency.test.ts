/**
 * Quote-urgency tests.  npm run test:quote-urgency
 *
 * Pure + offline. The dates here are the real shapes the API returns:
 * UTC-midnight, date-only values out of Postgres.
 *
 * The bug these exist for: reading a stored date with LOCAL getters
 * shifts it a day backwards anywhere west of Greenwich. The first cut of
 * this module put "picked up 1d ago" on a job picking up this morning
 * and "picks up TODAY" on one leaving tomorrow — both plausible, both
 * wrong, and both the sort of thing a rep would act on.
 */

import {
  daysUntil, quoteUrgency, pickupLabel, fmtPickup, todayPacific,
} from '../../src/lib/sales/quoteUrgency'

const failures: string[] = []
const check = (c: boolean, why: string) => {
  console.log(c ? `  ok — ${why}` : `  FAIL — ${why}`)
  if (!c) failures.push(why)
}

// Late evening Pacific on Aug 31 — the window where UTC has already
// rolled to Sep 1 and a UTC-based "today" gets the day wrong.
const PACIFIC_EVENING = new Date('2026-09-01T04:30:00Z')
// Mid-morning Pacific the same day, when UTC and Pacific agree.
const PACIFIC_MORNING = new Date('2026-08-31T17:00:00Z')

console.log('Today is the Pacific calendar day, not the UTC one')
check(todayPacific(PACIFIC_EVENING) === '2026-08-31',
  '9:30pm Pacific on Aug 31 is still Aug 31, though UTC says Sep 1')
check(todayPacific(PACIFIC_MORNING) === '2026-08-31', '10am Pacific on Aug 31 is Aug 31')

console.log('\nA stored UTC-midnight date keeps its calendar day')
for (const now of [PACIFIC_EVENING, PACIFIC_MORNING]) {
  check(daysUntil('2026-08-31T00:00:00.000Z', now) === 0,
    'a job picking up TODAY reads 0 — not -1, whatever the hour')
  check(daysUntil('2026-09-01T00:00:00.000Z', now) === 1,
    'and tomorrow reads 1 — not 0')
}
check(daysUntil('2026-08-22T00:00:00.000Z', PACIFIC_MORNING) === -9, 'nine days back')
check(daysUntil(null) === null, 'no date is null, not zero')
check(daysUntil('nonsense') === null, 'a malformed date is null, never a silent 0')

console.log('\nBands follow what a rep can still do')
const band = (iso: string) => quoteUrgency(iso, PACIFIC_MORNING)
check(band('2026-08-30T00:00:00.000Z') === 'past',    'yesterday is past')
check(band('2026-08-31T00:00:00.000Z') === 'today',   'today is today')
check(band('2026-09-01T00:00:00.000Z') === 'critical','tomorrow is critical')
check(band('2026-09-02T00:00:00.000Z') === 'critical','2 days is still critical')
check(band('2026-09-03T00:00:00.000Z') === 'soon',    '3 days is soon')
check(band('2026-09-06T00:00:00.000Z') === 'soon',    '6 days is the last soon day')
check(band('2026-09-07T00:00:00.000Z') === 'open',    'a week out is open')
check(quoteUrgency(null) === 'unknown', 'a missing date is unknown')
check(quoteUrgency(null) !== 'open',
  'and NOT open — silence about a missing date would read as reassurance')

console.log('\nLabels say the same thing the bands do')
const lbl = (iso: string | null) => pickupLabel(iso, PACIFIC_MORNING)
check(lbl('2026-08-31T00:00:00.000Z') === 'picks up TODAY', 'today')
check(lbl('2026-09-01T00:00:00.000Z') === 'picks up tomorrow', 'tomorrow')
check(lbl('2026-09-04T00:00:00.000Z') === 'picks up in 4d', 'in 4d')
check(lbl('2026-08-26T00:00:00.000Z') === 'picked up 5d ago', '5d ago')
check(lbl(null) === 'no pickup date', 'names the gap rather than leaving it blank')

console.log('\nThe printed date agrees with the label')
check(fmtPickup('2026-08-22T00:00:00.000Z') === 'Aug 22',
  'Aug 22 prints as Aug 22 — not Aug 21, which local parsing would give')
check(fmtPickup('2026-09-01T00:00:00.000Z') === 'Sep 1', 'Sep 1 prints as Sep 1')
check(fmtPickup(null) === null, 'no date prints nothing')

console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll quote-urgency tests passed.')
process.exitCode = failures.length ? 1 : 0
