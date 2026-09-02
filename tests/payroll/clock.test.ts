/**
 * Pacific clock ⇄ instant conversion.
 *
 *   npm run test:payroll-clock
 *
 * These tests are the reason the payroll code never calls getHours(). Every
 * expectation below is stated as a UTC instant, so a regression that reads
 * punches in the server's zone (UTC on Vercel) fails loudly here instead of
 * quietly shifting every crew member's call time by seven hours.
 */

import { parseClock, clockToInstant, instantToClock, punchesFor } from '../../src/lib/payroll/clock'

const failures: string[] = []
const check = (c: boolean, why: string) => {
  console.log(c ? `  ok — ${why}` : `  FAIL — ${why}`)
  if (!c) failures.push(why)
}
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

console.log('\nParsing what an admin types')
check(parseClock('8:00') === 480, '"8:00" → 480 minutes')
check(parseClock('08:00') === 480, 'a leading zero is the same')
check(parseClock('0800') === 480, 'and so is "0800" — the paper sheet is written both ways')
check(parseClock('17:30') === 1050, '24-hour times parse')
check(parseClock('00:00') === 0, 'midnight is 0, not null')
check(parseClock('') === null && parseClock(null) === null, 'empty is null, not 0 — an unworked day is not a midnight punch')
check(parseClock('25:00') === null && parseClock('8:70') === null, 'out-of-range values are rejected rather than rolled over')
check(parseClock('lunch') === null, 'garbage is rejected')

console.log('\nPacific, not UTC and not the server zone')
check(clockToInstant(day('2026-08-17'), 8 * 60).toISOString() === '2026-08-17T15:00:00.000Z',
  '8:00 on Aug 17 (PDT, UTC−7) is 15:00Z — a server reading this in UTC would call it 3pm')
check(clockToInstant(day('2026-01-15'), 8 * 60).toISOString() === '2026-01-15T16:00:00.000Z',
  '8:00 on Jan 15 (PST, UTC−8) is 16:00Z — the offset is asked for per date, never assumed')
check(instantToClock(new Date('2026-08-17T15:00:00.000Z')) === '08:00', 'and it round-trips back to "08:00"')
check(instantToClock(new Date('2026-01-15T16:00:00.000Z')) === '08:00', 'in winter too')
check(instantToClock(null) === null, 'a missing punch stays missing')

console.log('\nDST boundaries — the twice-a-year payroll bug')
check(instantToClock(clockToInstant(day('2026-03-08'), 9 * 60)) === '09:00',
  '9:00 on spring-forward Sunday round-trips')
check(instantToClock(clockToInstant(day('2026-11-01'), 9 * 60)) === '09:00',
  '9:00 on fall-back Sunday round-trips')

console.log('\nNight shoots — the overnight roll')
const nightP = punchesFor(day('2026-08-17'), '14:00', '02:00')
check(nightP.outAt!.getTime() - nightP.inAt!.getTime() === 12 * 3_600_000,
  'in 14:00 / out 02:00 is a 12-hour span — the out rolls to the next day')
check(nightP.outAt!.toISOString().slice(0, 10) === '2026-08-18',
  'and the out instant genuinely lands on Aug 18')
const dayP = punchesFor(day('2026-08-17'), '08:00', '17:00')
check(dayP.outAt!.getTime() - dayP.inAt!.getTime() === 9 * 3_600_000,
  'an ordinary day does NOT roll — 8a to 5p stays 9 hours')
check(punchesFor(day('2026-08-17'), '08:00', null).outAt === null,
  'a missing out stays null rather than defaulting to anything')
check(punchesFor(day('2026-08-17'), null, '17:00').inAt === null,
  'and a missing in stays null — the grid flags it, the math does not invent it')
const equalP = punchesFor(day('2026-08-17'), '08:00', '08:00')
check(equalP.outAt!.getTime() - equalP.inAt!.getTime() === 24 * 3_600_000,
  'in === out rolls to a 24-hour span, which the exceptions strip surfaces as a long day rather than reporting 0')

console.log(failures.length ? `\n${failures.length} FAILED\n` : '\nAll payroll clock tests passed\n')
process.exit(failures.length ? 1 : 0)
