/**
 * Public supply-cart estimate tests — what the CLIENT is allowed to price.
 *
 *   npx tsx tests/site/supply-cart-estimate.test.ts
 *   npm run test:supply-estimate
 *
 * Pure + offline.
 *
 * Wes 2026-09-11: "The client shouldn't be able to select 1d 2d or 3d,
 * that is a sirreel decision."
 *
 * The store's Shoot-days field is a REQUEST an agent reviews. It used to
 * feed `lineEstimate`, which meant the client chose their own billing
 * basis: 1 shoot day on a six-day rental cut the line, its group
 * subtotal and the cart's Estimated total to a sixth. No other part of
 * the system agreed — `/api/public/supply-request` snapshots
 * `rentalDaysBetween`, and billableDays is SirReel's to set — so the
 * figure the client anchored on was the one nobody had approved.
 *
 * These lock the two halves together: the cart prices CALENDAR days, and
 * it equals the server's snapshot for the same line.
 */

import { lineEstimate, rentalDaysBetween, type CartLine } from '../../src/hooks/useSupplyCart'
import { computeDays } from '../../src/lib/orders/days'

const failures: string[] = []
function check(got: unknown, want: unknown, why: string): void {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) console.log(`  ok — ${why}`)
  else {
    console.log(`  FAIL — ${why}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
    failures.push(why)
  }
}

function cartLine(over: Partial<CartLine> = {}): CartLine {
  return {
    cartLineId: 'c1',
    itemKind: 'SUPPLY',
    itemId: 'inv-1',
    name: 'Surveillance Kit',
    price: 7,
    qty: 6,
    type: 'EQUIPMENT',
    category: 'Communications',
    available: true,
    pickupDate: '2026-09-13',
    returnDate: '2026-09-19',
    ...over,
  } as CartLine
}

/** The server's snapshot math in /api/public/supply-request — the number
 *  SirReel records for the same cart. The client must see this one. */
function serverSnapshot(line: CartLine): number {
  if (line.price === 0) return 0
  const isRental = line.itemKind === 'VEHICLE' || line.type === 'EQUIPMENT'
  const days = isRental ? rentalDaysBetween(line.pickupDate, line.returnDate) : 1
  return line.price * line.qty * days
}

// ── The day count is INCLUSIVE, and it is not this file's to decide ──
//
// Sep 13 → Sep 19 is SEVEN days: the rental touches the 13th and the 19th
// and every day between. `src/lib/orders/days.ts` is the billable-days
// authority (Wes ruling B, 2026-07-17) and says so in as many words —
// "the calendar days the rental TOUCHES, both ends included".
//
// These four checks were written against the EXCLUSIVE gap and never
// updated when that flipped on 2026-09-12, so they have been failing ever
// since, asserting 6 days and $252 against a system that correctly bills 7
// and $294. Nothing was overcharging: the test was a cycle behind.
//
// Why the flip happened, because it is the thing that must not be undone:
// line create was ALREADY billing inclusively while this derivation was
// exclusive, so the order page read "3/2" — billing 3 days of a 2-day
// rental — which looks like an overcharge to the client and to the rep
// (Wes, forwarded 2026-09-12).
//
// So the assertion below is against `computeDays` rather than a number.
// Three implementations have to agree — `computeDays`, `calendarDays` in
// billing.ts and `rentalDays` in orders.ts — and the cart is downstream of
// all of them. A hardcoded literal here is what let this drift for a week;
// pinned to the authority, the cart cannot disagree with what gets billed.
console.log('\nthe week is not the client’s to pick')
const full = cartLine()
check(
  rentalDaysBetween('2026-09-13', '2026-09-19'),
  computeDays('2026-09-13T00:00:00Z', '2026-09-19T00:00:00Z'),
  'the cart reads the billable-days authority, not its own arithmetic',
)
check(rentalDaysBetween('2026-09-13', '2026-09-19'), 7, 'both ends included — the 13th through the 19th')
check(rentalDaysBetween('2026-09-14', '2026-09-16'), 3, "days.ts's own worked example: Sep 14 → 16 is 3")
check(lineEstimate(full), 294, '6 kits × $7 × 7 days')
check(
  lineEstimate(cartLine({ claimedDays: 1 })),
  294,
  'one shoot day claimed — the estimate does not move',
)
check(
  lineEstimate(cartLine({ claimedDays: 3 })),
  294,
  'a 3-day claim is not a 3-day week either',
)
check(
  lineEstimate(cartLine({ claimedDays: 99 })),
  294,
  'and a claim cannot inflate it — the basis is the dates, full stop',
)

console.log('\nthe cart agrees with what SirReel records')
for (const claim of [null, 1, 2, 3, 6]) {
  const l = cartLine({ claimedDays: claim })
  check(lineEstimate(l), serverSnapshot(l), `claim ${claim ?? 'none'} — cart === request snapshot`)
}

console.log('\nthe rest of the math is untouched')
check(lineEstimate(cartLine({ price: 0 })), 0, 'price-on-quote stays $0, not a guess')
check(
  lineEstimate(cartLine({ type: 'EXPENDABLE', price: 12, qty: 2, claimedDays: 1 })),
  24,
  'expendables are bought, not rented — qty × price, no days',
)
check(
  // $100 x 1 x the same inclusive 7 days as every other rental line above.
  lineEstimate(cartLine({ itemKind: 'VEHICLE', type: 'VEHICLE', price: 100, qty: 1, claimedDays: 1 })),
  700,
  'a vehicle is a rental by kind even when its type is not EQUIPMENT',
)
check(
  lineEstimate(cartLine({ pickupDate: '2026-09-13', returnDate: '2026-09-13' })),
  42,
  'same-day pickup and return is one day, not zero',
)

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('supply-cart-estimate: all checks passed')
