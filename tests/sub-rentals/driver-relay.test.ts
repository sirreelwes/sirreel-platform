/**
 * Guards the driver relay's address parsing — the one piece of this feature
 * that runs against EVERY message in a live company mailbox.
 *
 * The failure that matters is a FALSE POSITIVE: if parseRelayTag ever claims
 * ordinary jobs@ mail, that message gets forwarded to a driver. So the first
 * block is entirely "must not claim", and it is the block to extend first if
 * the address scheme ever changes.
 *
 *   npm run test:driver-relay
 */
import { parseRelayTag, relayAddress, relayDirection } from '@/lib/sub-rentals/driverRelay'

let fail = 0
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

console.log('— must NOT claim ordinary mail —')
eq('plain jobs@',            parseRelayTag('jobs@sirreel.com'), null)
eq('jobs@ with display',     parseRelayTag('"SirReel Jobs" <jobs@sirreel.com>'), null)
eq('other inbox',            parseRelayTag('billing@sirreel.com'), null)
eq('outside domain',         parseRelayTag('jobs+x.abc@gmail.com'), null)
eq('empty',                  parseRelayTag(''), null)
eq('null',                   parseRelayTag(null), null)
eq('unrelated plus tag',     parseRelayTag('billing+ref123@sirreel.com'), null)

console.log('\n— must claim ours —')
eq('plus form',              parseRelayTag('jobs+mike-torres.a1b2c3d4e5f6@sirreel.com'), 'mike-torres.a1b2c3d4e5f6')
eq('with display name',      parseRelayTag('Driver <jobs+mike-torres.a1b2c3d4e5f6@sirreel.com>'), 'mike-torres.a1b2c3d4e5f6')
eq('mixed recipient list',   parseRelayTag('someone@prod.com, jobs+bob.deadbeef1234@sirreel.com'), 'bob.deadbeef1234')
eq('uppercase',              parseRelayTag('JOBS+Bob.DEADBEEF1234@SirReel.com'), 'bob.deadbeef1234')
eq('dotted form (future)',   parseRelayTag('bob.deadbeef1234.jobs@sirreel.com'), 'bob.deadbeef1234')

console.log('\n— address shape —')
eq('relayAddress',           relayAddress('bob.deadbeef1234'), 'jobs+bob.deadbeef1234@sirreel.com')

console.log('\n— direction / loop guard —')
const t = { subRentalId: 's', driverName: 'Bob', driverEmail: 'bob@driver.com',
  jobCode: 'SR-JOB-1', vehicleName: 'EcoFlux', productionEmail: 'prod@show.com', productionName: 'Prod' }
eq('production → driver',    relayDirection('someone@show.com', t), 'to-driver')
eq('driver → production',    relayDirection('Bob <bob@driver.com>', t), 'to-production')
eq('driver, no production',  relayDirection('bob@driver.com', { ...t, productionEmail: null }), null)
eq('no from address',        relayDirection('', t), null)

console.log(fail ? `\n${fail} FAILURE(S)` : '\nall passed')
process.exit(fail ? 1 : 0)
