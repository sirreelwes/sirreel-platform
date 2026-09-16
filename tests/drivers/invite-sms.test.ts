/**
 * The texted driver invite (Wes 2026-09-15: "onboard drivers with a text
 * and they can enter their email").
 *
 *   npx tsx tests/drivers/invite-sms.test.ts
 *   npm run test:invite-sms
 *
 * Pure + offline: the message body and the rules around it. The send
 * itself is sendTracked's, which has its own consent/quiet-hours tests.
 */

import { buildDriverAssignmentSms } from '../../src/lib/sms/templates/driverAssignmentSms'
import { toE164 } from '../../src/lib/sms/sendSms'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

const base = {
  driverFirstName: 'Luis',
  unitName: 'Pass 8',
  productionName: 'Wrong Number',
  pickupDate: '2026-09-16',
  jobLink: 'https://tsx.sirreel.com/drive/abc-123',
  needsLicense: true,
  unattendedPickup: false,
}

const msg = buildDriverAssignmentSms(base)
check('names the driver', msg.includes('Luis'))
check('names the unit', msg.includes('Pass 8'))
check('names the production', msg.includes('Wrong Number'))
check('reads the date, not an ISO string', msg.includes('Wed, Sep 16') && !msg.includes('2026-09-16'))
check('carries the link', msg.includes(base.jobLink))
check('asks for the licence when one is needed', /license/i.test(msg))

// The STOP line is sendTracked's job — writing it here would double it.
check('does not write its own STOP line', !/STOP/i.test(msg))

// A code in a text is a code in a stranger's lock screen. The page gates
// codes on name + phone + licence; the message never carries one.
const blind = buildDriverAssignmentSms({ ...base, unattendedPickup: true })
check('says nobody will meet them on a blind pickup', /nobody/i.test(blind))
check('never puts a code in the message', !/\b\d{4,}\b/.test(blind.replace(base.jobLink, '')))

const noName = buildDriverAssignmentSms({ ...base, driverFirstName: null, productionName: null })
check('survives an unknown driver', noName.startsWith('SirReel:') && !noName.includes('null'))
check('survives an unnamed production', !noName.includes('undefined'))

const known = buildDriverAssignmentSms({ ...base, needsLicense: false })
check('drops the licence ask once one is on file', !/license/i.test(known))

// What the invite validates before it will text at all.
check('a real mobile normalises', toE164('(310) 555-1234') === '+13105551234')
check('a short number does not', toE164('555-1234') === null)

if (failures.length) {
  console.error(`\n${failures.length} FAILED:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\nall driver SMS invite checks passed')
