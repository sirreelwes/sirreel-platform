/**
 * The driver is told when the van under them changes, or when either end
 * of the handoff stops being attended.
 *
 *   npx tsx tests/drivers/driver-change-notice.test.ts
 *   npm run test:driver-change-notice
 *
 * Pure + offline: no DB, no env.
 *
 * Jose's case is the first block (SR-JOB-0379, 2026-09-18): a driver
 * already invited on Pass 2, moved to Pass 10, and the pickup made blind.
 * The properties that matter most are the last three —
 *
 *   · a code that MOVED is named, because the driver is holding one that
 *     no longer opens anything;
 *   · nothing changed sends nothing, which is what keeps a rep double-
 *     tapping a chip off a stranger's phone;
 *   · the dedupe signature separates A→B from B→C, so the second swap in
 *     a row is never swallowed as a repeat.
 */

import {
  describeNotices,
  driverChanges,
  driverNoticeSms,
  lockboxMoved,
  noticeLines,
  noticeRoute,
  noticeSignature,
  noticeSubject,
  type DriverNoticeFacts,
  type DriverNoticeOutcome,
} from '../../src/lib/drivers/driverNoticeRule'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

const facts = (over: Partial<DriverNoticeFacts> = {}): DriverNoticeFacts => ({
  previousUnitName: null,
  unitName: 'Pass 10',
  productionName: 'Bryght Young Things',
  pickupDate: '2026-09-21',
  pickup: { before: false, now: false },
  dropoff: { before: false, now: false },
  ...over,
})

console.log("Jose's case — Pass 2 → Pass 10, and the pickup goes blind")
{
  const f = facts({
    previousUnitName: 'Pass 2',
    pickup: { before: false, now: true },
    dropoff: { before: false, now: true },
  })
  const c = driverChanges(f)
  check('the vehicle leads', c[0] === 'vehicle')
  check('the pickup going unattended is carried', c.includes('pickup-unattended'))
  check('so is the return', c.includes('return-unattended'))
  const lines = noticeLines(f, c)
  check('it names both vans', lines.some((l) => l.includes('Pass 10') && l.includes('Pass 2')))
  check(
    'it says nobody will be at the yard',
    lines.some((l) => l.toLowerCase().includes('nobody will be at the yard')),
  )
  check('the subject leads with the vehicle', noticeSubject(f, c).startsWith('Change of vehicle'))
  check('the subject names the production', noticeSubject(f, c).includes('Bryght Young Things'))
}

console.log('the line that earns the feature — the lockbox code moved with the van')
{
  const f = facts({ previousUnitName: 'Pass 2', pickup: { before: true, now: true } })
  const c = driverChanges(f)
  check('only the vehicle changed', c.length === 1 && c[0] === 'vehicle')
  check('but the code moved, because the pickup is blind', lockboxMoved(f, c))
  const lines = noticeLines(f, c)
  check(
    "it says the old code won't open it",
    lines.some((l) => l.includes('will not open it') && l.includes('Pass 2')),
  )
  const sms = driverNoticeSms({ driverFirstName: 'David', facts: f, changes: c, jobLink: 'https://x/drive/t' })
  check('the text says it too', sms.includes("won't open it"))
  check('the text NEVER carries a code — those are released on the page', !/\b\d{4,}\b/.test(sms))
}

console.log('a swap on an ATTENDED handoff releases no code, so none is claimed to have moved')
{
  const f = facts({ previousUnitName: 'Pass 2' })
  const c = driverChanges(f)
  check('the vehicle still changed', c.includes('vehicle'))
  check('no lockbox sentence', !lockboxMoved(f, c))
  check('and none in the words', !noticeLines(f, c).some((l) => l.includes('lockbox')))
}

console.log('a swap we could not NAME still reaches the driver')
{
  // The regression this guard exists for: reading the swap off
  // `previousUnitName` alone meant a failed lookup of the outgoing asset
  // read as "nothing changed", and the driver was told nothing — on the
  // exact case the feature was built for.
  const f = facts({ vehicleChanged: true, previousUnitName: null, pickup: { before: false, now: true } })
  const c = driverChanges(f)
  check('the vehicle change is still raised', c.includes('vehicle'))
  check(
    'and the words fall back to naming only the new van',
    noticeLines(f, c).some((l) => l === "You're now driving Pass 10."),
  )
  check('the lockbox sentence still fires', lockboxMoved(f, c))
  check(
    'and hedges the old van it cannot name',
    noticeLines(f, c).some((l) => l.includes('the other vehicle')),
  )
}

console.log('nothing changed — nothing is sent')
{
  check('a re-pick of the same unit is not a change', driverChanges(facts({ previousUnitName: 'Pass 10' })).length === 0)
  check(
    'even when the caller insists it swapped',
    driverChanges(facts({ vehicleChanged: true, previousUnitName: 'Pass 10' })).length === 0,
  )
  check('no swap and no flip is not a change', driverChanges(facts()).length === 0)
  check(
    'writing the value already stored is not a change',
    driverChanges(facts({ pickup: { before: true, now: true }, dropoff: { before: true, now: true } })).length === 0,
  )
}

console.log('turning blind back OFF is told too — someone WILL be there now')
{
  const f = facts({ pickup: { before: true, now: false } })
  const c = driverChanges(f)
  check('it reads as attended', c.length === 1 && c[0] === 'pickup-attended')
  check(
    'and says a person will meet them',
    noticeLines(f, c).some((l) => l.includes('will now meet you')),
  )
  check('the subject says so', noticeSubject(f, c).startsWith('Someone will meet you'))
}

console.log('the dedupe signature separates one swap from the next')
{
  const ab = facts({ previousUnitName: 'Pass 2', unitName: 'Pass 10' })
  const bc = facts({ previousUnitName: 'Pass 10', unitName: 'Pass 12' })
  const sigAB = noticeSignature(ab, driverChanges(ab))
  const sigBC = noticeSignature(bc, driverChanges(bc))
  check('A→B and B→C are different messages', sigAB !== sigBC)
  check('the same swap twice is one message', sigAB === noticeSignature(ab, driverChanges(ab)))
  const blindToo = facts({ previousUnitName: 'Pass 2', unitName: 'Pass 10', pickup: { before: false, now: true } })
  check(
    'the same van but a different handoff is a different message',
    sigAB !== noticeSignature(blindToo, driverChanges(blindToo)),
  )
}

console.log('the notice travels the way the invite did')
{
  check(
    'texted invite → texted notice, even with an email on file',
    noticeRoute({ invitedBySms: '+13105551234', email: 'd@x.com' })?.channel === 'SMS',
  )
  check(
    'emailed invite → emailed notice, even with a mobile on file',
    noticeRoute({ invitedByEmail: 'd@x.com', phone: '+13105551234' })?.channel === 'EMAIL',
  )
  check(
    'neither on the invite → whatever the file has',
    noticeRoute({ email: 'd@x.com' })?.to === 'd@x.com',
  )
  check('nothing at all → null, never a silent no-op', noticeRoute({}) === null)
  check('blank strings are not an address', noticeRoute({ invitedByEmail: '  ', email: '' }) === null)
}

console.log('what the rep is told')
{
  const sent: DriverNoticeOutcome = {
    driverAssignmentId: '1', driverName: 'David Trinidad', changes: ['vehicle'],
    channel: 'SMS', sentTo: '+1', status: 'sent',
  }
  const stuck: DriverNoticeOutcome = {
    driverAssignmentId: '2', driverName: 'May Ortiz', changes: ['vehicle'],
    channel: null, sentTo: null, status: 'unreachable',
  }
  check('a send reads good', describeNotices([sent])?.tone === 'good')
  check('it names the person and the channel', !!describeNotices([sent])?.text.includes('David Trinidad was texted'))
  check('one unreachable driver turns the whole line to a warning', describeNotices([sent, stuck])?.tone === 'warn')
  check(
    'and is never folded into a count — the rep has to phone them',
    !!describeNotices([sent, stuck])?.text.includes('tell them yourself'),
  )
  check('nobody named → nothing to say', describeNotices([]) === null)
  check(
    'a swallowed repeat is not reported as a send',
    describeNotices([{ ...sent, status: 'duplicate' }]) === null,
  )
}

console.log('')
if (failures.length) {
  console.error(`FAILED (${failures.length}):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All driver-change-notice checks passed.')
