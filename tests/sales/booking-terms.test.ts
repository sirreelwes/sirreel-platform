/**
 * Booking-details tests.
 *
 *   npm run test:booking-terms
 *
 * Pure + offline.
 *
 * Weighted toward the two places the block deliberately does NOT repeat the
 * prose it replaced, because both are cases where the prose promised a client
 * something HQ knows to be false, and both would read as harmless copy edits
 * to whoever "simplified" them back:
 *
 *   1. the card fee is a CAP, not a flat rate;
 *   2. LCDW is not offered on vehicles the rental agreement excludes.
 *
 * The rest guard the arithmetic-shaped mistakes: a term printed on an order it
 * cannot apply to, and the wrong rental cycle named on a mixed order.
 */

import {
  buildBookingTerms,
  classifyVehicleLine,
  periodTermsFor,
  cardFeeBody,
  BOOKING_POLICY,
  type BookingTerm,
  type BookingTermKey,
  type BookingVehicleLine,
} from '../../src/lib/sales/bookingTerms'
import { CARD_SURCHARGE_RATE } from '../../src/lib/payments/surcharge'
import {
  LCDW_DAILY_RATE,
  LCDW_WAIVED_DAMAGE_LIMIT,
  FUEL_PER_GALLON,
} from '../../src/lib/contracts/fees'
import { YARD_HOURS, YARD_HOURS_ONE_LINE } from '../../src/lib/site/yardHours'

const failures: string[] = []
const check = (c: boolean, why: string) => {
  console.log(c ? `  ok — ${why}` : `  FAIL — ${why}`)
  if (!c) failures.push(why)
}

const veh = (over: Partial<BookingVehicleLine> = {}): BookingVehicleLine => ({
  description: 'SuperCube Truck',
  code: 'CAT_CUBE_TRUCK',
  ...over,
})

const keys = (terms: BookingTerm[]) => terms.map((t) => t.key)
const find = (terms: BookingTerm[], key: string) => terms.find((t) => t.key === key)

// ─────────────────────────────────────────────────────────────────────
console.log('\n1. The card fee is a CAP, not a flat rate')
// The legacy portal promised a flat 3% to every client who got a link because
// the corrected string lived in one file and the promise in another. Restating
// it here would walk that back on the quote PDF instead.
check(/up to 3%/.test(cardFeeBody), 'states "up to 3%"')
check(!/\ba 3% (processing )?fee will apply\b/i.test(cardFeeBody),
  'does NOT promise a flat fee on every card')
check(/waived/i.test(cardFeeBody) && /debit/i.test(cardFeeBody) && /prepaid/i.test(cardFeeBody),
  'names the debit / prepaid waiver')
check(/states that do not allow it/i.test(cardFeeBody),
  'names the state-level waiver')
check(cardFeeBody.includes(`${(CARD_SURCHARGE_RATE * 100).toFixed(0)}%`),
  'the percentage is derived from CARD_SURCHARGE_RATE, not typed in')
check(new RegExp(`${BOOKING_POLICY.achDueBusinessDays} business days`).test(cardFeeBody),
  'names the ACH / check deadline')

// ─────────────────────────────────────────────────────────────────────
console.log('\n2. LCDW is judged against the order, never offered blanket')
const popvanOnly = buildBookingTerms({
  vehicles: [veh({ code: 'CAT_POPVAN', description: 'PopVan' })],
})
const popvanTerm = find(popvanOnly, 'lcdw')
check(!!popvanTerm, 'a PopVan-only order still gets an LCDW term (silence would be worse)')
check(/not available/i.test(popvanTerm!.body),
  'and it says the waiver is NOT available rather than quoting a price')
check(!popvanTerm!.body.includes(`$${LCDW_DAILY_RATE}`),
  'the $/day figure is absent when nothing on the order is eligible')

const mixed = buildBookingTerms({
  vehicles: [
    veh(),
    veh({ code: 'CAT_POPVAN', description: 'PopVan' }),
  ],
})
const mixedTerm = find(mixed, 'lcdw')!
check(mixedTerm.body.includes(`$${LCDW_DAILY_RATE}`),
  'a mixed order DOES get the offer — the eligible truck is coverable')
check(!!mixedTerm.note && /PopVan/.test(mixedTerm.note),
  'and a note names the PopVan as excluded, on the quote, not at claim time')

const allEligible = buildBookingTerms({ vehicles: [veh()] })
check(find(allEligible, 'lcdw')!.note === undefined,
  'no exclusion note when every vehicle is eligible')

// Partner units: the claim being waived is not SirReel's to waive.
const partner = buildBookingTerms({
  vehicles: [veh({ description: 'Cube Truck (King Kong)', isPartnerVehicle: true })],
})
check(/not available/i.test(find(partner, 'lcdw')!.body),
  'a partner-fulfilled vehicle is not offered the waiver')

// ─────────────────────────────────────────────────────────────────────
console.log('\n3. Contract figures are read, not restated')
check(BOOKING_POLICY.lcdwPerDay === LCDW_DAILY_RATE, 'LCDW/day tracks LCDW_DAILY_RATE')
check(BOOKING_POLICY.lcdwCoverage === LCDW_WAIVED_DAMAGE_LIMIT,
  'LCDW coverage tracks LCDW_WAIVED_DAMAGE_LIMIT')
check(BOOKING_POLICY.refuelPerGallon === FUEL_PER_GALLON,
  'refueling tracks FUEL_PER_GALLON')
check(find(allEligible, 'refueling')!.body.includes(`$${FUEL_PER_GALLON}/gallon`),
  'and the refueling sentence prints that figure')

// ─────────────────────────────────────────────────────────────────────
console.log('\n4. Lot hours come from the after-hours source of truth')
const lot = find(allEligible, 'lot-access')!
check(lot.body.includes(YARD_HOURS_ONE_LINE), 'the one-line hours are used verbatim')
for (const [label, value] of Object.entries(YARD_HOURS)) {
  // "6:00 AM – 6:00 PM, Monday through Friday" → the times must survive into
  // the one-liner. A drift here means the packet and the quote disagree about
  // when the gate is open, which is a driver at a locked gate.
  const times = value.match(/\d{1,2}:\d{2} [AP]M/g) ?? []
  check(times.every((t) => YARD_HOURS_ONE_LINE.includes(t)),
    `${label} hours appear in the one-liner (${times.join(' / ') || 'n/a'})`)
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n5. Vehicle terms are omitted on a gear-only order')
const gearOnly = buildBookingTerms({ vehicles: [] })
for (const k of ['truck-period', 'van-period', 'refueling', 'mileage', 'parking', 'lcdw'] as BookingTermKey[]) {
  check(!keys(gearOnly).includes(k), `no "${k}" term without vehicles`)
}
for (const k of ['lot-access', 'trash', 'cancellation', 'card-fees'] as BookingTermKey[]) {
  check(keys(gearOnly).includes(k), `"${k}" still applies to a gear-only order`)
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n6. Truck vs van — the rental cycle must not be misstated')
check(classifyVehicleLine(veh()) === 'truck', 'SuperCube by code → truck')
check(classifyVehicleLine(veh({ code: 'CAT_CARGO_VAN_LIFTGATE', description: 'Cargo Van w/ Liftgate' })) === 'van',
  'Cargo Van by code → van')
check(classifyVehicleLine(veh({ code: null, description: 'cube truck' })) === 'truck',
  'a hand-typed "cube truck" still classifies (rep typed instead of picking)')
check(classifyVehicleLine(veh({ code: null, description: 'Video Van / ProScout Sprinter' })) === 'van',
  'a hand-typed Video Van classifies as a van, not a truck')
check(classifyVehicleLine(veh({ code: null, description: 'Honeywagon' })) === 'unknown',
  'a honeywagon is neither — unknown, not a guess')

check(periodTermsFor([veh()]).join() === 'truck', 'truck-only order names ONLY the 24-hour cycle')
check(periodTermsFor([veh({ code: 'CAT_PASSENGER_VAN', description: '15-Passenger Van' })]).join() === 'van',
  'van-only order names ONLY the calendar day')
// The unsafe direction: narrowing to one cycle on an order carrying both, or
// carrying something unrecognised, tells the client the wrong billing basis.
check(periodTermsFor([veh(), veh({ code: 'CAT_PASSENGER_VAN', description: '15-Passenger Van' })]).length === 2,
  'a MIXED order shows both cycles')
check(periodTermsFor([veh(), veh({ code: null, description: 'Honeywagon' })]).length === 2,
  'an order with an unrecognised unit shows both cycles rather than guessing')

const truckTerms = buildBookingTerms({ vehicles: [veh()] })
check(!keys(truckTerms).includes('van-period'), 'and the van term is genuinely absent on a truck-only order')
check(find(truckTerms, 'truck-period')!.body.includes(`$${BOOKING_POLICY.truckHourlyOverage}/hour`),
  'the truck term prints the hourly overage')
check(/1 additional rental day/.test(find(truckTerms, 'truck-period')!.body),
  'and the cap on it — an uncapped hourly rate is a different promise')

// ─────────────────────────────────────────────────────────────────────
console.log('\n7. Mileage + parking say what the prose said')
const m = find(truckTerms, 'mileage')!
check(m.body.includes(`${BOOKING_POLICY.mileageIncludedPerDay} miles per rental day`), '100 mi/day included')
check(m.body.includes(`${BOOKING_POLICY.mileageIncludedPerWeek} miles per week`), '500 mi/week included')
check(m.body.includes('$0.50/mile'), 'overage at $0.50/mile, cents kept')
check(!!m.note && /out of the county/i.test(m.note), 'the out-of-county heads-up survives as a note')

check(/2 in tandem per truck/.test(find(truckTerms, 'parking')!.body),
  'truck-only order states tandem parking only')
const vanTerms = buildBookingTerms({ vehicles: [veh({ code: 'CAT_PASSENGER_VAN', description: '15-Passenger Van' })] })
check(!/tandem/.test(find(vanTerms, 'parking')!.body),
  'van-only order does not promise tandem spaces')

check(find(truckTerms, 'trash')!.body.includes(`$${BOOKING_POLICY.trashPerBag}/bag`), 'trash at $25/bag')
check(find(truckTerms, 'cancellation')!.body.includes(`${BOOKING_POLICY.cancellationWindowHours} hours`),
  'cancellation window stated in hours')

// ─────────────────────────────────────────────────────────────────────
console.log('\n8. Shape')
check(new Set(keys(truckTerms)).size === keys(truckTerms).length, 'keys are unique (React needs them to be)')
check(truckTerms.every((t) => t.title.length > 0 && t.body.length > 0), 'every term has a title and a body')
check(keys(truckTerms)[0] === 'lot-access', 'lot access leads — it is the first thing a driver needs')
check(keys(truckTerms)[keys(truckTerms).length - 1] === 'card-fees', 'payment closes the block')

console.log(
  failures.length === 0
    ? `\n✓ all booking-details checks passed\n`
    : `\n✗ ${failures.length} FAILED:\n${failures.map((f) => `  - ${f}`).join('\n')}\n`,
)
process.exit(failures.length === 0 ? 0 : 1)
