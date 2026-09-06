/**
 * Bounce-event classification — which recipient a Resend bounce is about,
 * and whether it may change a delivery's status or suppress an address.
 *
 *   npm run test:bounce-event
 *
 * Pure + offline. Every case is the 2026-09-04 weekend: Oliver's Gmail
 * out-of-office auto-reply reached SES's bounce address and came back as
 * a Transient/General bounce against "Oliver Carlson <oliver@sirreel.com>"
 * on twelve client emails that had all been delivered.
 */

import { bareAddress, classifyBounceEvent } from '../../src/lib/email/bounceEvent'
import { normalizeSuppressionEmail } from '../../src/lib/outreach/suppression'

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok   ${name}`)
  else { failures++; console.log(`  FAIL ${name}`, detail ?? '') }
}

const delivery = { toAddress: 'brianaplewman@gmail.com', ccAddresses: ['rentals@sirreel.com', 'oliver@sirreel.com'] }

console.log('bareAddress')
check('strips display name', bareAddress('Oliver Carlson <oliver@sirreel.com>') === 'oliver@sirreel.com')
check('lowercases', bareAddress('  Briana@Gmail.com ') === 'briana@gmail.com')
check('rejects non-address', bareAddress('nobody') === null)
check('suppression key is the bare address', normalizeSuppressionEmail('oliver carlson <oliver@sirreel.com>') === 'oliver@sirreel.com')

console.log('CC auto-reply bounce (the weekend)')
{
  const v = classifyBounceEvent({ eventType: 'email.bounced', eventTo: ['Oliver Carlson <oliver@sirreel.com>'], bounceType: 'Transient', delivery })
  check('attributed to the CC', v.role === 'cc', v)
  check('does not touch the delivery status', v.affectsDelivery === false, v)
  check('does not suppress on a transient', v.shouldSuppress === false, v)
}

console.log('To bounces for real')
{
  const v = classifyBounceEvent({ eventType: 'email.bounced', eventTo: ['brianaplewman@gmail.com'], bounceType: 'Permanent', delivery })
  check('attributed to the To', v.role === 'to', v)
  check('changes the delivery status', v.affectsDelivery === true, v)
  check('suppresses a permanent bounce', v.shouldSuppress === true, v)
}
{
  const v = classifyBounceEvent({ eventType: 'email.bounced', eventTo: 'brianaplewman@gmail.com', bounceType: 'Transient', delivery })
  check('a transient To bounce still marks the delivery', v.affectsDelivery === true, v)
  check('but does not suppress', v.shouldSuppress === false, v)
}

console.log('complaints')
{
  const v = classifyBounceEvent({ eventType: 'email.complained', eventTo: ['oliver@sirreel.com'], bounceType: null, delivery })
  check('a CC complaint suppresses the CC', v.shouldSuppress === true && v.bouncedAddress === 'oliver@sirreel.com', v)
  check('but leaves the To delivery alone', v.affectsDelivery === false, v)
}

console.log('no row to compare against')
{
  const v = classifyBounceEvent({ eventType: 'email.bounced', eventTo: ['someone@example.com'], bounceType: 'Permanent', delivery: null })
  check('falls back to the old behaviour: status applies', v.affectsDelivery === true && v.role === 'unknown', v)
  check('permanent still suppresses', v.shouldSuppress === true, v)
}
{
  const v = classifyBounceEvent({ eventType: 'email.bounced', eventTo: [], bounceType: 'Permanent', delivery })
  check('no recipient → nothing to suppress', v.shouldSuppress === false && v.bouncedAddress === null, v)
}

if (failures) { console.log(`\n${failures} failing`); process.exit(1) }
console.log('\nall passed')
