/**
 * How long a unit is N/A — the rule behind `src/lib/scheduling/naDuration.ts`.
 *
 * Sales/fleet, 2026-09-15: "sometimes they know it's only going to be a day
 * or two." Every N/A record used to be open-ended, so a one-day fix held a
 * truck out until somebody remembered to Clear it. The prompt now picks a
 * length; the route stores the LAST day out, inclusive, and availability's
 * existing endDate overlap test releases the unit the day after.
 *
 * Run: npm run test:na-duration
 */
import {
  addDaysYmd,
  naEndForDays,
  naInEffect,
  naReturnLine,
  parseNaEndDate,
  NA_MAX_DAYS,
} from '@/lib/scheduling/naDuration'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

console.log('\n— inclusive calendar days —')
eq('1 day from Tue 9/15 is out 9/15 only', naEndForDays('2026-09-15', 1), '2026-09-15')
eq('2 days from 9/15 → last day 9/16', naEndForDays('2026-09-15', 2), '2026-09-16')
eq('1 week from 9/15 → last day 9/21', naEndForDays('2026-09-15', 7), '2026-09-21')
eq('month rollover', naEndForDays('2026-09-29', 3), '2026-10-01')
eq('0 days is still at least today', naEndForDays('2026-09-15', 0), '2026-09-15')

console.log('\n— requested end dates —')
eq('omitted → until cleared', parseNaEndDate(undefined, '2026-09-15'), { ok: true, endYmd: null })
eq('null → until cleared', parseNaEndDate(null, '2026-09-15'), { ok: true, endYmd: null })
eq('today is allowed (a 1-day N/A)', parseNaEndDate('2026-09-15', '2026-09-15'), { ok: true, endYmd: '2026-09-15' })
eq('yesterday refused', parseNaEndDate('2026-09-14', '2026-09-15').ok, false)
eq('not a real day refused', parseNaEndDate('2026-02-30', '2026-09-15').ok, false)
eq('wrong shape refused', parseNaEndDate('9/16/2026', '2026-09-15').ok, false)
eq('number refused', parseNaEndDate(3, '2026-09-15').ok, false)
eq('cap is allowed', parseNaEndDate(addDaysYmd('2026-09-15', NA_MAX_DAYS), '2026-09-15').ok, true)
eq('past the cap refused', parseNaEndDate(addDaysYmd('2026-09-15', NA_MAX_DAYS + 1), '2026-09-15').ok, false)

console.log('\n— in effect —')
eq('open-ended is always in effect', naInEffect(null, '2026-12-01'), true)
eq('on its last day it is still out', naInEffect(new Date('2026-09-16T00:00:00.000Z'), '2026-09-16'), true)
eq('the day after, the unit is back', naInEffect(new Date('2026-09-16T00:00:00.000Z'), '2026-09-17'), false)
eq('ymd strings from the timeline payload work too', naInEffect('2026-09-16', '2026-09-15'), true)

console.log('\n— wording —')
eq('dated', naReturnLine('2026-09-16'), 'Out through Wed, Sep 16 — bookable again Thu, Sep 17')
eq('open-ended', naReturnLine(null), 'Stays N/A until fleet clears it')

console.log(fail === 0 ? '\nall na-duration checks passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
