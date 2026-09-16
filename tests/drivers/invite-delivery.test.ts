/**
 * "Did the driver's invite text reach them?" — the state mapping.
 *
 *   npm run test:invite-delivery
 *
 * Pure + offline. Guards the one thing a rep acts on: a message that
 * never left HQ must read as a FAILURE, not as "still sending". The
 * lifecycle words are Twilio's; the skipped-* ones are ours.
 */

import { __testing } from '../../src/lib/drivers/inviteDelivery'

const { classify, labelFor } = __testing
const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

check('delivered is delivered', classify('delivered', null) === 'delivered')
check('sent is sent', classify('sent', null) === 'sent')
check('queued is still in flight', classify('queued', null) === 'pending')
check('undelivered is a failure', classify('undelivered', null) === 'failed')
check('failed is a failure', classify('failed', null) === 'failed')

// Ours — these never reached Twilio at all.
check('opted out is a failure, not pending', classify('skipped-opted-out', null) === 'failed')
check('unconfigured is a failure, not pending', classify('skipped-unconfigured', null) === 'failed')
check('quiet hours is a failure state (it has not gone yet)', classify('skipped-quiet', null) === 'failed')
check('an error text alone fails it', classify(null, 'Twilio 30034') === 'failed')

// The words a rep reads have to say what to DO about it.
check('STOP is named', labelFor('failed', 'skipped-opted-out').includes('STOP'))
check('texting-off is named', labelFor('failed', 'skipped-unconfigured').includes('texting is off'))
check('quiet hours says it is held, not lost', labelFor('failed', 'skipped-quiet').includes('morning'))
check('a plain failure says not delivered', labelFor('failed', 'failed').includes('not delivered'))
check('delivered reads plainly', labelFor('delivered', 'delivered') === 'Text delivered')

if (failures.length) {
  console.error(`\n${failures.length} FAILED:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\nall invite-delivery checks passed')
