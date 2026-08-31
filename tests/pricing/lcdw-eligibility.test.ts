/**
 * LCDW eligibility tests.
 *
 *   npm run test:lcdw
 *
 * Pure + offline. Every code below is a real row in the VEHICLES catalog.
 *
 * The stakes are asymmetric and the tests are weighted accordingly:
 * charging LCDW on a vehicle the agreement excludes means taking money
 * for coverage that does not exist, and the client finds out at claim
 * time. Missing a waiver we could have sold costs a line item.
 */

import {
  judgeLcdwLine, quoteLcdw, describeLcdwCoverage, LCDW_EXCLUDED_CODES,
  type LcdwCandidate,
} from '../../src/lib/pricing/lcdwEligibility'

const failures: string[] = []
const check = (c: boolean, why: string) => {
  console.log(c ? `  ok — ${why}` : `  FAIL — ${why}`)
  if (!c) failures.push(why)
}

const line = (over: Partial<LcdwCandidate> = {}): LcdwCandidate => ({
  id: 'l1', description: 'SuperCube Truck', code: 'CAT_CUBE_TRUCK',
  department: 'VEHICLES', quantity: 1, billableDays: 3, ...over,
})

console.log('\nThe two exclusions Wes named')
check(!judgeLcdwLine(line({ code: 'CAT_POPVAN', description: 'PopVan' })).eligible,
  'PopVan is NOT eligible')
check(!judgeLcdwLine(line({ code: 'CAT_PROSCOUT_VTR', description: 'ProScout / VideoVan' })).eligible,
  'ProScout / VideoVan is NOT eligible')
check(judgeLcdwLine(line({ code: 'CAT_POPVAN' })).reason === 'specialty-vehicle',
  'and the reason names it as a specialty vehicle, matching the addendum wording')

console.log('\nEvery other catalogued vehicle IS eligible')
for (const [code, desc] of [
  ['CAT_CUBE_TRUCK', 'SuperCube Truck'],
  ['CAT_CARGO_VAN_LIFTGATE', 'Cargo Van w/ Liftgate'],
  ['CAT_CARGO_VAN_NO_LIFTGATE', 'Cargo Van w/o Liftgate'],
  ['CAT_PASSENGER_VAN', 'Passenger Van'],
  ['CAT_CAMERA_CUBE', 'Camera Cube'],
] as const) {
  check(judgeLcdwLine(line({ code, description: desc })).eligible, `${desc} is eligible`)
}

console.log('\nNon-vehicle lines are not vehicles')
check(judgeLcdwLine(line({ department: 'GE', description: 'Grip package' })).reason === 'not-a-vehicle',
  'a G&E line is not a vehicle')
check(judgeLcdwLine(line({ department: 'STAGES', description: 'Stage A' })).reason === 'not-a-vehicle',
  'a stage is not a vehicle')

console.log('\nAn unmatched vehicle line is eligible, deliberately')
check(judgeLcdwLine(line({ code: null, description: 'cube truck (typed)' })).eligible,
  'a typed VEHICLES line with no catalog code still gets coverage — the exclusions are specific catalogued vehicles, and denying a waiver because a rep typed instead of picked would deny what the contract grants')

console.log('\nVehicle-days is quantity × days')
check(judgeLcdwLine(line({ quantity: 2, billableDays: 3 })).vehicleDays === 6, '2 vans × 3 days = 6')
check(judgeLcdwLine(line({ quantity: 1, billableDays: null })).vehicleDays === 0, 'null days = 0, never NaN')

console.log('\nA mixed order reports BOTH sides')
{
  const q = quoteLcdw([
    line({ id: 'a', code: 'CAT_PASSENGER_VAN', description: 'Passenger Van', quantity: 1, billableDays: 3 }),
    line({ id: 'b', code: 'CAT_CUBE_TRUCK', description: 'SuperCube Truck', quantity: 2, billableDays: 3 }),
    line({ id: 'c', code: 'CAT_POPVAN', description: 'PopVan', quantity: 1, billableDays: 3 }),
    line({ id: 'd', department: 'GE', description: 'Grip package' }),
  ])
  check(q.eligible.length === 2, 'two eligible vehicle lines')
  check(q.excluded.length === 1 && q.excluded[0].description === 'PopVan',
    'the PopVan is RETURNED as excluded, not silently dropped')
  check(q.vehicleDays === 9, '(1×3) + (2×3) = 9 vehicle-days, PopVan not counted')
  check(!q.allExcluded, 'not an all-excluded order')
  check(!q.eligible.some((e) => e.description === 'Grip package'), 'the G&E line is absent from both sides')
  const text = describeLcdwCoverage(q)
  check(text.includes('9 vehicle-days') && text.includes('PopVan'),
    `summary states coverage AND the gap: "${text}"`)
}

console.log('\nAn order of only specialty vehicles says so plainly')
{
  const q = quoteLcdw([
    line({ id: 'a', code: 'CAT_POPVAN', description: 'PopVan' }),
    line({ id: 'b', code: 'CAT_PROSCOUT_VTR', description: 'ProScout / VideoVan' }),
  ])
  check(q.allExcluded && q.vehicleDays === 0, 'nothing to charge')
  check(describeLcdwCoverage(q).startsWith('Not available'),
    'and the copy leads with "Not available" rather than offering a $0 waiver')
}

console.log('\nNo vehicles at all')
check(describeLcdwCoverage(quoteLcdw([line({ department: 'GE' })])) === 'No vehicles on this order.',
  'says so rather than showing an empty offer')

console.log('\nThe exclusion set is exactly the two the agreement names')
check(LCDW_EXCLUDED_CODES.size === 2, 'two codes excluded')

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`)
  failures.forEach((f) => console.error(`  - ${f}`))
  process.exit(1)
}
console.log('\nAll LCDW eligibility tests passed.\n')
