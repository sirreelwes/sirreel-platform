/**
 * TODAY is the yard's date, not UTC's (2026-09-16 — Wes: "It seems like
 * HQ thinks today is 9/18").
 *
 * At 5:40pm in Sun Valley on Sept 16 the UTC date is already Sept 17. A
 * dozen screens read `new Date().toISOString().slice(0, 10)`, so from 5pm
 * until midnight the reservations board, the jobs board's cadence, the
 * calendar's today ring and a new reservation's default start were all a
 * day ahead — and "tomorrow" on those screens was the 18th.
 *
 * Asserted, with the clock pinned:
 *   · the moment Wes reported: UTC says the 17th, the yard says the 16th;
 *   · the boundary is 5pm PDT / 4pm PST, not midnight UTC;
 *   · the cadence pair (today / tomorrow) follows the same clock;
 *   · the month helper follows it too (the 1st at 6pm is still last month);
 *   · the fleet check-window module re-exports the SAME function.
 *
 * Run: npm run test:pacific-day
 */
import { pacificYmd, pacificDays, pacificYm } from '@/lib/dates/pacificDay'
import { pacificYmd as fromCheckWindow } from '@/lib/fleet/checkWindow'
import { cadenceDays } from '@/lib/jobs/cadence'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const at = (iso: string) => new Date(iso).getTime()

console.log('\n— the moment Wes reported —')
const wes = at('2026-09-17T00:40:00Z') // 5:40pm PDT, Sept 16
eq('UTC already says the 17th', new Date(wes).toISOString().slice(0, 10), '2026-09-17')
eq('the yard says the 16th', pacificYmd(0, wes), '2026-09-16')
eq('tomorrow is the 17th, not the 18th', pacificYmd(1, wes), '2026-09-17')

console.log('\n— the boundary is the yard\'s midnight —')
eq('11:59pm PDT is still today', pacificYmd(0, at('2026-09-17T06:59:00Z')), '2026-09-16')
eq('midnight PDT rolls it', pacificYmd(0, at('2026-09-17T07:00:00Z')), '2026-09-17')
eq('4:59pm PDT (UTC still today)', pacificYmd(0, at('2026-09-16T23:59:00Z')), '2026-09-16')
eq('5:00pm PDT (UTC has rolled, the yard has not)', pacificYmd(0, at('2026-09-17T00:00:00Z')), '2026-09-16')
// Standard time: the UTC rollover lands at 4pm.
eq('4:30pm PST in December is still today', pacificYmd(0, at('2026-12-11T00:30:00Z')), '2026-12-10')
eq('midnight PST rolls it', pacificYmd(0, at('2026-12-11T08:00:00Z')), '2026-12-11')

console.log('\n— the cadence pair —')
eq('pacificDays at 5:40pm', pacificDays(wes), { today: '2026-09-16', tomorrow: '2026-09-17' })
eq('cadenceDays is the same clock (number)', cadenceDays(wes), { today: '2026-09-16', tomorrow: '2026-09-17' })
eq('cadenceDays is the same clock (Date)', cadenceDays(new Date(wes)), { today: '2026-09-16', tomorrow: '2026-09-17' })
eq('across a month end', pacificDays(at('2026-10-01T02:00:00Z')), { today: '2026-09-30', tomorrow: '2026-10-01' })

console.log('\n— the month —')
eq('the 1st at 6pm PDT (UTC says the 1st) is still last month', pacificYm(at('2026-10-01T01:00:00Z')), '2026-09')
eq('the 1st at noon is this month', pacificYm(at('2026-10-01T19:00:00Z')), '2026-10')

console.log('\n— one function, re-exported —')
eq('checkWindow re-exports the same helper', fromCheckWindow === pacificYmd, true)

if (fail) { console.error(`\n${fail} failing`); process.exit(1) }
console.log('\nall good')
