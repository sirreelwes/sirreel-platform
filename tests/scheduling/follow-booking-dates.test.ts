/**
 * The order follows the reservation's dates — the rule behind
 * `src/lib/scheduling/followBookingDates.ts`.
 *
 * Wes, 2026-09-18: "You should be able to edit the dates of the
 * reservation and have it adjust the order and vice versa." A drag is a
 * TRANSLATION (everything moves, no money moves); retyping one edge is a
 * RESIZE (only what sits on that edge follows, and it re-prices). These
 * cases pin which windows move, which stay and why.
 *
 * Run: npm run test:follow-booking-dates
 */
process.env.TZ = 'America/Los_Angeles'

import { planWindowFollow, moveDeltaDays } from '@/lib/scheduling/followBookingDates'
import { projectLineMoney } from '@/lib/orders/datePushPreview'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
const w = (start: string, end: string) => ({ start: d(start), end: d(end) })
const say = (r: ReturnType<typeof planWindowFollow>) =>
  r.move ? `${r.move.start.toISOString().slice(0, 10)}→${r.move.end.toISOString().slice(0, 10)}` : `stay:${r.stay}`

// ── A drag: both edges move the same number of days ───────────────────
const drag = { from: w('2027-03-10', '2027-03-14'), to: w('2027-03-12', '2027-03-16') }

eq('the reservation itself moves', say(planWindowFollow({ ...drag, window: w('2027-03-10', '2027-03-14') })), '2027-03-12→2027-03-16')
eq('a line on the whole window moves with it', say(planWindowFollow({ ...drag, window: w('2027-03-10', '2027-03-14') })), '2027-03-12→2027-03-16')
eq('an INTERIOR block moves too on a drag', say(planWindowFollow({ ...drag, window: w('2027-03-11', '2027-03-12') })), '2027-03-13→2027-03-14')
eq('a one-day line keeps its length', say(planWindowFollow({ ...drag, window: w('2027-03-14', '2027-03-14') })), '2027-03-16→2027-03-16')
eq('delta in days', moveDeltaDays(drag.from, drag.to), 2)

// ── A resize: the end moved out, the start did not ────────────────────
const longer = { from: w('2027-03-10', '2027-03-14'), to: w('2027-03-10', '2027-03-18') }
eq('the line that ends on the old end follows', say(planWindowFollow({ ...longer, window: w('2027-03-10', '2027-03-14') })), '2027-03-10→2027-03-18')
eq('a second block INSIDE the old window is left alone', say(planWindowFollow({ ...longer, window: w('2027-03-11', '2027-03-12') })), 'stay:interior')
eq('a block that only ends on the old end stretches', say(planWindowFollow({ ...longer, window: w('2027-03-12', '2027-03-14') })), '2027-03-12→2027-03-18')

// ── A resize from the front ───────────────────────────────────────────
const earlier = { from: w('2027-03-10', '2027-03-14'), to: w('2027-03-08', '2027-03-14') }
eq('the line that starts on the old start follows', say(planWindowFollow({ ...earlier, window: w('2027-03-10', '2027-03-14') })), '2027-03-08→2027-03-14')
eq('a later block keeps its own pickup', say(planWindowFollow({ ...earlier, window: w('2027-03-12', '2027-03-14') })), 'stay:interior')

// ── Degenerate moves ──────────────────────────────────────────────────
eq('nothing moved', say(planWindowFollow({ from: w('2027-03-10', '2027-03-14'), to: w('2027-03-10', '2027-03-14'), window: w('2027-03-10', '2027-03-14') })), 'stay:unchanged')
eq(
  'a shrink that would end a block before it starts is refused, not inverted',
  say(planWindowFollow({ from: w('2027-03-10', '2027-03-14'), to: w('2027-03-10', '2027-03-11'), window: w('2027-03-12', '2027-03-14') })),
  'stay:would-invert',
)
eq(
  'a line whose own start is the old start and whose end is the old end cannot invert',
  say(planWindowFollow({ from: w('2027-03-10', '2027-03-14'), to: w('2027-03-16', '2027-03-14') , window: w('2027-03-10', '2027-03-14') })),
  'stay:would-invert',
)

// ── The money rule ────────────────────────────────────────────────────
const line = {
  department: 'VEHICLES' as const,
  type: 'VEHICLE' as const,
  rateType: 'DAILY' as const,
  rate: 100,
  quantity: 1,
  billableDays: 3,
  lineTotal: 300,
}
eq(
  'a translation does not change the money',
  projectLineMoney({ ...line, pickupDate: d('2027-03-12'), returnDate: d('2027-03-14') }),
  { billableDays: 3, lineTotal: 300 },
)
eq(
  'a longer window re-prices',
  projectLineMoney({ ...line, pickupDate: d('2027-03-10'), returnDate: d('2027-03-14') }),
  { billableDays: 5, lineTotal: 500 },
)
eq(
  'a discount line is day-invariant',
  projectLineMoney({ ...line, type: 'DISCOUNT' as const, lineTotal: -85, billableDays: 3, pickupDate: d('2027-03-10'), returnDate: d('2027-03-20') }),
  { billableDays: 3, lineTotal: -85 },
)

console.log(fail === 0 ? '\nAll follow-booking-dates cases pass.' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
