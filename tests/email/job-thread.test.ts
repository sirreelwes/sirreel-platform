/**
 * One thread per job — the pure rules.
 *
 *   npm run test:job-thread
 *
 * Offline. Guards the three anchors every client-facing send carries
 * (src/lib/email/jobThreadRules.ts): the minted Message-ID + References
 * chain, the job address on Cc, and the one stable subject — and the
 * parser the ingest uses to read the job address back off a message.
 */

import {
  JOB_MESSAGE_HEADER,
  isJobCode,
  jobCodeFromHeaders,
  jobRootThreadKey,
  jobThreadAddress,
  mintJobMessageId,
  mintedJobSubject,
  normalizeSubject,
  parseJobThreadTag,
  parseMessageIds,
  rootSubjectFor,
  threadSendSubject,
  threadingHeaders,
  withJobAddress,
  withoutJobAddress,
} from '../../src/lib/email/jobThreadRules'
import { parseRelayTag } from '../../src/lib/sub-rentals/driverRelay'

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok   ${name}`)
  else { failures++; console.log(`  FAIL ${name}`, detail ?? '') }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

console.log('\n— anchor B: the job address —')
check('address is jobs+<code lower>@sirreel.com', jobThreadAddress('SR-JOB-0219') === 'jobs+sr-job-0219@sirreel.com')
check('parses back off a bare address', parseJobThreadTag('jobs+sr-job-0219@sirreel.com') === 'SR-JOB-0219')
check('parses off a display-name Cc header with other people on it',
  parseJobThreadTag('Dev Patel <dev@acmepictures.com>, "SirReel" <JOBS+SR-JOB-0219@SIRREEL.COM>') === 'SR-JOB-0219')
check('accepts the dotted spelling a routing rule would enable', parseJobThreadTag('sr-job-0219.jobs@sirreel.com') === 'SR-JOB-0219')
check('ordinary jobs@ mail is not claimed', parseJobThreadTag('jobs@sirreel.com') === null)
check('a driver-relay tag is not a job code', parseJobThreadTag('jobs+luis-garcia.3f9a1c2b7d4e@sirreel.com') === null)
check('another domain is never ours', parseJobThreadTag('jobs+sr-job-0219@example.com') === null)
check('jobCodeFromHeaders reads To, then Cc, then Delivered-To',
  jobCodeFromHeaders([null, 'x@y.com', 'jobs+sr-job-0007@sirreel.com']) === 'SR-JOB-0007')
check('isJobCode', isJobCode('SR-JOB-0001') && isJobCode('sr-job-12') && !isJobCode('SR-ORD-0001') && !isJobCode(''))
// The pubsub route checks the job code BEFORE the driver relay, because
// parseRelayTag would otherwise claim the address as a relay tag and try
// to forward the client's mail to a driver that does not exist.
check('parseRelayTag WOULD claim the job address (so the route must check ours first)',
  parseRelayTag('jobs+sr-job-0219@sirreel.com') === 'sr-job-0219')

console.log('\n— anchor B on the Cc list —')
check('adds the address once, keeps the client Cc', eq(
  withJobAddress(['dev@acmepictures.com'], ['sarah@acmepictures.com'], 'SR-JOB-0219'),
  ['dev@acmepictures.com', 'jobs+sr-job-0219@sirreel.com'],
))
check('never duplicates it', eq(
  withJobAddress(['jobs+sr-job-0219@sirreel.com', 'dev@acmepictures.com'], ['sarah@acmepictures.com'], 'SR-JOB-0219'),
  ['jobs+sr-job-0219@sirreel.com', 'dev@acmepictures.com'],
))
check('drops a Cc that is already the To', eq(
  withJobAddress(['sarah@acmepictures.com', 'Dev@AcmePictures.com'], ['sarah@acmepictures.com'], 'SR-JOB-0219'),
  ['Dev@AcmePictures.com', 'jobs+sr-job-0219@sirreel.com'],
))
check('undefined Cc → just the address', eq(withJobAddress(undefined, ['s@a.com'], 'SR-JOB-0219'), ['jobs+sr-job-0219@sirreel.com']))
check('withoutJobAddress strips ours and only ours', eq(
  withoutJobAddress(['dev@acmepictures.com', 'jobs+sr-job-0219@sirreel.com', 'rentals@sirreel.com']),
  ['dev@acmepictures.com', 'rentals@sirreel.com'],
))

console.log('\n— anchor C: one subject —')
check('minted subject', mintedJobSubject('Big Production', 'sr-job-0219') === 'Big Production — SirReel (SR-JOB-0219)')
check('blank name still reads', mintedJobSubject('', 'SR-JOB-0219') === 'Your production — SirReel (SR-JOB-0219)')
check('normalizeSubject strips stacked prefixes', normalizeSubject('Re: RE: Fwd: FW: Rental inquiry // Cortex') === 'Rental inquiry // Cortex')
check('normalizeSubject strips the [n] counter form', normalizeSubject('Re[2]: Quote') === 'Quote')
check('normalizeSubject leaves a plain subject alone', normalizeSubject('  Big Production — SirReel (SR-JOB-0219) ') === 'Big Production — SirReel (SR-JOB-0219)')
check('root adopts the client\'s filed subject when there is one',
  rootSubjectFor({ jobName: 'Big Production', jobCode: 'SR-JOB-0219', filedSubject: 'Re: Rental inquiry // Cortex Creative' }) === 'Rental inquiry // Cortex Creative')
check('root is minted when nothing is filed',
  rootSubjectFor({ jobName: 'Big Production', jobCode: 'SR-JOB-0219', filedSubject: null }) === 'Big Production — SirReel (SR-JOB-0219)')
check('root is minted when the filed subject is empty / (no subject)',
  rootSubjectFor({ jobName: 'Big Production', jobCode: 'SR-JOB-0219', filedSubject: '(no subject)' }) === 'Big Production — SirReel (SR-JOB-0219)'
  && rootSubjectFor({ jobName: 'Big Production', jobCode: 'SR-JOB-0219', filedSubject: 'Re: ' }) === 'Big Production — SirReel (SR-JOB-0219)')
check('first send carries no Re:', threadSendSubject('Big Production — SirReel (SR-JOB-0219)', true) === 'Big Production — SirReel (SR-JOB-0219)')
check('later sends carry Re: exactly once', threadSendSubject('Big Production — SirReel (SR-JOB-0219)', false) === 'Re: Big Production — SirReel (SR-JOB-0219)'
  && threadSendSubject('Re: Big Production — SirReel (SR-JOB-0219)', false) === 'Re: Big Production — SirReel (SR-JOB-0219)')

console.log('\n— anchor A: the References chain —')
const id1 = mintJobMessageId('SR-JOB-0219', '0f4c1d2e-1111-4a5b-8c9d-000000000001')
check('minted id is RFC 5322 shaped and names the job', id1 === '<jt.sr-job-0219.0f4c1d2e-1111-4a5b-8c9d-000000000001@sirreel.com>')
check('minted id parses back as a message id token', eq(parseMessageIds(`${id1} <other@x>`), [id1, '<other@x>']))
const first = threadingHeaders({ messageId: id1 })
check('first send: Message-ID + marker, no In-Reply-To, no References',
  first['Message-ID'] === id1 && first[JOB_MESSAGE_HEADER] === id1 && !('In-Reply-To' in first) && !('References' in first))
const id2 = '<jt.sr-job-0219.2222@sirreel.com>'
const clientReply = '<CAF+abc123@mail.gmail.com>'
const second = threadingHeaders({ messageId: id2, rootMessageId: id1, lastMessageId: clientReply })
check('reply: In-Reply-To names the last message (the client\'s)', second['In-Reply-To'] === clientReply)
check('reply: References runs root → last', second['References'] === `${id1} ${clientReply}`)
const onlyRoot = threadingHeaders({ messageId: id2, rootMessageId: id1, lastMessageId: id1 })
check('root === last is not repeated', onlyRoot['References'] === id1 && onlyRoot['In-Reply-To'] === id1)
check('marker header name is stable (the ingest reads it by name)', JOB_MESSAGE_HEADER === 'X-SirReel-Job-Message')
check('root thread key is deterministic per job', jobRootThreadKey('abc') === 'hq-job-abc')

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
