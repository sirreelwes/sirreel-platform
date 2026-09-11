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

console.log('\nthe week is not the client’s to pick')
const full = cartLine()
check(rentalDaysBetween('2026-09-13', '2026-09-19'), 6, 'six calendar days')
check(lineEstimate(full), 252, '6 kits × $7 × 6 days')
check(
  lineEstimate(cartLine({ claimedDays: 1 })),
  252,
  'one shoot day claimed — the estimate does not move',
)
check(
  lineEstimate(cartLine({ claimedDays: 3 })),
  252,
  'a 3-day claim is not a 3-day week either',
)
check(
  lineEstimate(cartLine({ claimedDays: 99 })),
  252,
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
  lineEstimate(cartLine({ itemKind: 'VEHICLE', type: 'VEHICLE', price: 100, qty: 1, claimedDays: 1 })),
  600,
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
