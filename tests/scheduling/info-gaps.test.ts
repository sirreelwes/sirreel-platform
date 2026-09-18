/**
 * What a reservation still owes — `src/lib/scheduling/infoGaps.ts`.
 *
 * The ORDER gap is DERIVED since 2026-09-18. Wes: "of course every vehicle
 * will be attached to an order, because that is how we bill clients" — so
 * the old "an order will be attached" tick asked the desk to declare the
 * obvious, under a label they read as the WAREHOUSE order. These cases pin
 * the two guards that keep the derived version honest: an unknown order
 * count falls back to the declared rule, and a reservation that has already
 * ended is history, not a to-do.
 *
 * Run: npm run test:info-gaps
 */
process.env.TZ = 'America/Los_Angeles'

import { bookingInfoGaps, isOrderMissing } from '@/lib/scheduling/infoGaps'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const keys = (b: Parameters<typeof bookingInfoGaps>[0]) => bookingInfoGaps(b).map((g) => g.key)
const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
const past = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
const complete = { companyId: 'c1', jobId: 'j1', jobName: 'Something' }

eq('a live reservation with no order owes one', keys({ ...complete, orderCount: 0, endDate: future }), ['order'])
eq('an order on the job clears it', keys({ ...complete, orderCount: 1, endDate: future }), [])
eq('a finished reservation is history, not a to-do', keys({ ...complete, orderCount: 0, endDate: past }), [])
eq('no tick required any more', isOrderMissing({ orderCount: 0, endDate: future, expectsOrder: false }), true)
eq('an unknown order count falls back to the declared rule', isOrderMissing({ expectsOrder: true }), true)
eq('…and stays quiet when nothing was declared', isOrderMissing({ expectsOrder: false }), false)
eq('an undated reservation counts as live', isOrderMissing({ orderCount: 0 }), true)
eq(
  'the order sits last, after what an agent can answer first',
  keys({ companyId: null, jobId: null, jobName: '', orderCount: 0, endDate: future }),
  ['company', 'job', 'order'],
)

console.log(fail === 0 ? '\nAll info-gaps cases pass.' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
