/**
 * Partner lines stay off the pick list.
 *
 *   npm run test:partner-pick-list
 *
 * Pure + offline. Wes 2026-09-11: "keep partner lines off the pick list." A
 * partner's unit is delivered by the partner or collected from them; a pick
 * task for it is a task nobody on our floor can do, and an order waiting for
 * it to be loaded never reads ready.
 */
import { isPartnerLineIn, partnerRouting, PARTNER_SUB_RENTAL_WHERE, PARTNER_LINE_WHERE } from '../../src/lib/orders/partnerLines'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) console.log(`  ok — ${why}`)
  else failures.push(`${why}: got ${g}, wanted ${w}`)
}

console.log('Routing')
eq(partnerRouting({ lane: 'WAREHOUSE', pickStatus: 'PENDING_PICK' }, true), { lane: null, pickStatus: null }, 'a partner line that would go to the warehouse gets no lane and no pick status')
eq(partnerRouting({ lane: 'WAREHOUSE', pickStatus: 'PENDING_PICK' }, false), { lane: 'WAREHOUSE', pickStatus: 'PENDING_PICK' }, 'our own gear still goes to the warehouse')
eq(partnerRouting({ lane: 'FLEET', pickStatus: null }, true), { lane: 'FLEET', pickStatus: null }, 'a partner vehicle keeps its fleet lane — that is not the pick list')
eq(partnerRouting({ lane: 'STAGE', pickStatus: null }, true), { lane: 'STAGE', pickStatus: null }, 'stage routing is untouched')

console.log('What counts as a partner line')
eq(PARTNER_SUB_RENTAL_WHERE, { subcontractedVehicleId: { not: null }, status: { not: 'CANCELLED' } }, 'a roster unit, booking not cancelled — an ad-hoc gear sub-rental stays on the list')
eq((PARTNER_LINE_WHERE.OR ?? []).length, 2, 'the line itself, or the line it rides under')

console.log('On a loaded order (the pull sheet)')
const strobe = { id: 'L1', parentLineItemId: null, subRentals: [{ id: 'S1' }] }
const strobeDelivery = { id: 'L2', parentLineItemId: 'L1', subRentals: [] }
const ourCable = { id: 'L3', parentLineItemId: null, subRentals: [] }
const ourBattery = { id: 'L4', parentLineItemId: 'L3', subRentals: [] }
const order = [strobe, strobeDelivery, ourCable, ourBattery]
eq(isPartnerLineIn(strobe, order), true, 'the partner unit itself is off the sheet')
eq(isPartnerLineIn(strobeDelivery, order), true, 'what rides under it is off too')
eq(isPartnerLineIn(ourCable, order), false, 'our own gear stays on the sheet')
eq(isPartnerLineIn(ourBattery, order), false, 'an accessory under our gear stays on the sheet')

if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\nall partner pick-list checks passed')
