/**
 * Pickup at the partner's lot (WILL_CALL) — no driver asked for, anywhere.
 *
 *   npm run test:will-call
 *
 * Wes 2026-09-15, California Rent A Car: the production picks the car up at
 * the partner's lot and returns it there; delivery stays possible, arranged
 * by the partner with the client through the portal. The partner surfaces
 * were built for a roster driver taking the unit to set, so every one of
 * them asked for a driver. Pinned here:
 *   - the default chain: unit → partner → kind
 *   - the hold request and the go note never mention a driver for WILL_CALL
 *   - the account page raises no driver / driver-ack / call-time alert
 *   - driven and delivered units are unchanged
 */
import { defaultReceiveMethodFor, usesPartnerDriver, isReceiveMethod } from '@/lib/sub-rentals/partnerKind'
import { buildVendorHoldRequest, buildVendorBookedNotice, holdNextStep } from '@/lib/sub-rentals/vendorNotice'
import { unitAlertsFor } from '@/lib/sub-rentals/vendorAccount'

let fail = 0
const ok = (label: string, cond: boolean, detail?: unknown) => {
  if (!cond) fail++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond || detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`)
}

console.log('defaults')
ok('a car-rental partner’s unit starts as pickup at their lot', defaultReceiveMethodFor({ defaultReceiveMethod: null }, { partnerKind: 'VEHICLES', defaultReceiveMethod: 'WILL_CALL' }) === 'WILL_CALL')
ok('a unit’s own setting beats the partner default (a delivered one-off)', defaultReceiveMethodFor({ defaultReceiveMethod: 'DELIVERY' }, { partnerKind: 'VEHICLES', defaultReceiveMethod: 'WILL_CALL' }) === 'DELIVERY')
ok('King Kong (no partner default) is still driven', defaultReceiveMethodFor({ defaultReceiveMethod: null }, { partnerKind: 'VEHICLES', defaultReceiveMethod: null }) === 'PICKUP')
ok('PowerTrip (equipment, no default) is still delivered', defaultReceiveMethodFor(null, { partnerKind: 'EQUIPMENT' }) === 'DELIVERY')
ok('only PICKUP and legacy null use a partner driver', usesPartnerDriver('PICKUP') && usesPartnerDriver(null) && !usesPartnerDriver('WILL_CALL') && !usesPartnerDriver('DELIVERY'))
ok('WILL_CALL is a receive method; junk is not', isReceiveMethod('WILL_CALL') && !isReceiveMethod('will_call') && !isReceiveMethod('SHIP'))

const base = { vendorName: 'California Rent A Car', vehicleName: 'Chevy Suburban', startDate: '2026-09-20', endDate: '2026-09-22', reference: 'SR-JOB-0400', vendorUrl: 'https://sirreel.com/vendor/x', agentName: 'Jose' }

console.log('\nhold request')
const hold = buildVendorHoldRequest({ ...base, receiveMethod: 'WILL_CALL' } as Parameters<typeof buildVendorHoldRequest>[0])
ok('will-call hold never says driver', !/driver/i.test(hold.html) && !/driver/i.test(hold.text), hold.text)
ok('will-call hold says the production picks it up at their lot', /picks it up at your lot/.test(hold.text))
ok('driven hold still asks them to name a driver', /name your driver/.test(holdNextStep('PICKUP')) && /name your driver/.test(holdNextStep(null)))
ok('delivered hold asks for a delivery contact, not a driver', /delivery contact/.test(holdNextStep('DELIVERY')) && !/driver/i.test(holdNextStep('DELIVERY')))

console.log('\ngo note')
const go = buildVendorBookedNotice({ ...base, holdConfirmed: false, driverNamed: false, willCall: true } as Parameters<typeof buildVendorBookedNotice>[0])
ok('will-call go note never says driver', !/driver/i.test(go.html) && !/driver/i.test(go.text), go.text)
ok('will-call go note still asks them to confirm the hold', /confirm the hold/.test(go.text))
ok('will-call go note: collected at their lot, told who is coming', /picks it up at your lot/.test(go.text) && /who is collecting/.test(go.text))
const driven = buildVendorBookedNotice({ ...base, holdConfirmed: true, driverNamed: false } as Parameters<typeof buildVendorBookedNotice>[0])
ok('driven go note still asks for the driver', /name your driver/.test(driven.text))

console.log('\naccount alerts')
const row = { receiveMethod: 'WILL_CALL', vendorConfirmedAt: null, vendorDeclinedAt: null, driverName: null, driverAckedAt: null, callTime: null }
ok('will-call REQUESTED: only "confirm"', JSON.stringify(unitAlertsFor({ ...row, status: 'REQUESTED' })) === JSON.stringify(['confirm']))
ok('will-call CONFIRMED: nothing owed', unitAlertsFor({ ...row, status: 'CONFIRMED', vendorConfirmedAt: new Date() }).length === 0)
ok('driven CONFIRMED with no driver or call time: both alerts', JSON.stringify(unitAlertsFor({ ...row, receiveMethod: 'PICKUP', status: 'CONFIRMED' })) === JSON.stringify(['driver', 'call-time']))
ok('delivered REQUESTED: a delivery contact, not a driver', unitAlertsFor({ ...row, receiveMethod: 'DELIVERY', status: 'REQUESTED' }).includes('delivery-contact'))

if (fail) { console.log(`\n${fail} failing`); process.exit(1) }
console.log('\nall passing')
