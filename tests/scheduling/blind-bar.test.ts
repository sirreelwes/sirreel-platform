/**
 * The violet bar means ONE thing: nobody is handing this unit over.
 *
 *   npx tsx tests/scheduling/blind-bar.test.ts
 *   npm run test:blind-bar
 *
 * Oliver, 2026-09-18: "Can you remove the blind return buttons? ... It's
 * confusing the system because it makes the vehicle purple, so fleet
 * assumes the vehicle is going out blind." A blind RETURN is still a real
 * fact — the order carries it, the client gets drop-off instructions, and
 * Fleet Dispatch lights a needs-check-in alert — it just must never paint
 * a bar, a chip or a readiness wash. Pure + offline.
 */

import { barColor, BLIND_PICKUP_COLOR, blindLabel, isBlindBar, LEGEND_ITEMS, readinessMeterStyle } from '../../src/lib/scheduling/statusTokens'

const failures: string[] = []
function check(got: unknown, want: unknown, why: string) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'ok' : 'FAIL'} — ${why}${ok ? '' : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`)
  if (!ok) failures.push(why)
}

// A blind pickup still outranks every live stage — that is the alert.
check(isBlindBar('booked', { blindPickup: true }), true, 'blind pickup on a booked bar is violet')
check(isBlindBar('hold', { blindPickup: true }), true, 'a hold can be violet too (Make Reservation asks before the order exists)')
check(barColor('booked', { blindPickup: true }), BLIND_PICKUP_COLOR, 'barColor hands back the violet')

// A dead job has no handoff to warn about.
check(isBlindBar('cancelled', { blindPickup: true }), false, 'cancelled stays struck')
check(isBlindBar('lost', { blindPickup: true }), false, 'lost stays struck')

// The return edge is invisible to every colour and label.
check(isBlindBar('booked', {} as { blindPickup?: boolean }), false, 'a staffed handoff is not violet')
check(isBlindBar('booked', { blindReturn: true } as { blindPickup?: boolean }), false, 'a blind RETURN never paints the bar')
check(blindLabel({ blindReturn: true } as { blindPickup?: boolean }), null, 'a blind return has no bar chip')
check(blindLabel({ blindPickup: true }), 'Blind pickup', 'the only label is the pickup one')
check(
  LEGEND_ITEMS.some((i) => /return/i.test(i.label)),
  false,
  'the legend no longer promises a colour for returns',
)

// The readiness wash follows the same rule as the bar.
const wash = (opts: { blindPickup?: boolean }) => String(readinessMeterStyle(3, 5, { stage: 'booked', ...opts }).backgroundImage ?? '')
const VIOLET_300 = '196, 181, 253'
check(wash({ blindPickup: true }).includes(VIOLET_300), true, 'a blind pickup washes violet')
check(wash({ blindReturn: true } as { blindPickup?: boolean }).includes(VIOLET_300), false, 'a blind return washes with its stage, not violet')

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed')
process.exit(failures.length ? 1 : 0)
