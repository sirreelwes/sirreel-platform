/**
 * The broker off a COI, the link we send them, and what that link opens.
 *
 *   npx tsx tests/coi/broker-review.test.ts
 *   npm run test:coi-broker
 *
 * Pure + offline: no DB, no AI, no network. Two things here are worth a test
 * and they are worth it for opposite reasons.
 *
 *  1. WHO we email. The broker is read off a document by a model. An invented
 *     or mis-read address is a correction request sent to a stranger with our
 *     client's name in it, so a placeholder ("N/A", "same as insured") must
 *     never survive into a To: field, and an address that is not an address
 *     must never look like one.
 *  2. WHAT the link opens. The token is a credential a third party can
 *     forward. The packet is the disclosure envelope, so the test asserts
 *     what it does NOT carry as hard as what it does.
 */

import {
  brokerFirstName,
  brokerLabel,
  brokerReviewLinkLines,
  buildBrokerFixDraft,
  buildBrokerReviewPacket,
  readCoiBroker,
} from '../../src/lib/coi/broker'
import { normalizeCoiReview } from '../../src/lib/coi/reviewCoi'
import { evaluateInsuredMatch } from '../../src/lib/coi/insuredMatch'
import { signCoiBrokerToken, verifyCoiBrokerToken } from '../../src/lib/coi/brokerReviewToken'
import { signCoiToken } from '../../src/lib/coi/coiUploadToken'

// Both token modules read the secret at SIGN time, not at import time, so
// setting it here is enough.
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-broker-review'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

console.log('COI broker review\n')

// ── Reading the producer box ───────────────────────────────────────────────
console.log('— the broker off the certificate —')

const full = readCoiBroker({
  producer: {
    agency: 'Marsh Risk & Insurance Services',
    contactName: 'Jane Okafor',
    email: 'Jane.Okafor@Marsh.com',
    phone: '(213) 555-0134',
    address: '777 S Figueroa St, Los Angeles, CA 90017',
  },
})
check('a full producer block reads', full.found && full.extracted)
check('the email is lower-cased', full.email === 'jane.okafor@marsh.com')
check('the label leads with the person', brokerLabel(full) === 'Jane Okafor · Marsh Risk & Insurance Services')
check('the greeting uses the first name', brokerFirstName(full) === 'Jane')

// A review that never asked is not a blank producer box.
const older = readCoiBroker({ namedInsured: 'Acme Films, LLC' })
check('a pre-2026-09-17 review reads as never asked', !older.extracted && !older.found)
const asked = readCoiBroker({ producer: { agency: null, email: null } })
check('an asked-but-empty box reads as asked', asked.extracted && !asked.found)

// Placeholders are not brokers.
for (const junk of ['N/A', 'n/a', 'None', 'Same as insured', 'Unknown', '-', '   ']) {
  const b = readCoiBroker({ producer: { agency: junk, contactName: junk, email: junk } })
  check(`"${junk.trim() || '(blank)'}" is not a broker`, !b.found && b.email === null)
}
check(
  'a non-address in the email field is dropped, not sent to',
  readCoiBroker({ producer: { email: 'call the office' } }).email === null,
)
check(
  'a bare string producer is read as the agency',
  readCoiBroker({ producer: 'Hub International' }).agency === 'Hub International',
)
check('a review with no AI at all is empty, not a throw', readCoiBroker(null).found === false)

// Anything today's normalizer touches WAS asked — the prompt asks — so it
// always stamps the key, even when the producer box came back empty. That is
// what leaves "never asked" meaning only one thing: a review filed before the
// question existed, which no normalizer has run over since.
const normalized = normalizeCoiReview({ producer: { agency: null } } as never)
check('normalize keeps an all-null producer block', readCoiBroker(normalized).extracted)
check(
  'a review normalized today counts as asked even with nothing found',
  readCoiBroker(normalizeCoiReview({ namedInsured: 'X' } as never)).extracted === true,
)
check(
  'normalize invents no broker facts',
  readCoiBroker(normalizeCoiReview({ namedInsured: 'X' } as never)).found === false,
)

// A surname-first contact is not greeted by surname.
check('"Okafor, Jane" earns no first-name greeting', brokerFirstName(readCoiBroker({ producer: { contactName: 'Okafor, Jane' } })) === null)

// ── The token ──────────────────────────────────────────────────────────────
console.log('\n— the link —')

const tok = signCoiBrokerToken({ coiId: 'coi-123' })
check('a fresh token verifies to its certificate', verifyCoiBrokerToken(tok)?.coiId === 'coi-123')
check('a tampered payload does not verify', verifyCoiBrokerToken(`x${tok}`) === null)
check('a garbage token does not verify', verifyCoiBrokerToken('nope') === null && verifyCoiBrokerToken(null) === null)
check('an expired token does not verify', verifyCoiBrokerToken(signCoiBrokerToken({ coiId: 'coi-123' }, -1000)) === null)
// The domain separator earns its keep here: both schemes sign JSON with the
// same secret, so without it an upload token could open a broker review.
check(
  'an upload token cannot be replayed as a review token',
  verifyCoiBrokerToken(signCoiToken({ jobId: 'job-1' })) === null,
)

// ── The draft ──────────────────────────────────────────────────────────────
console.log('\n— what we write to them —')

const FAILING = {
  additionalInsured: { pass: false, note: 'Model prose naming requirements this job may not have.' },
  lossPayee: { pass: false },
  autoPhysicalDamage: { pass: false },
  generalLiability: { pass: true },
  autoLiability: { pass: true },
  certificateHolder: { pass: true },
  coverageDates: { pass: true },
  policyExpiry: { pass: true, expired: false },
  notes: 'Internal read of the document.',
}
const match = evaluateInsuredMatch('Acme Films, LLC', ['Acme Films, LLC'])

const draft = buildBrokerFixDraft({
  ai: FAILING,
  match,
  policyExpiryDate: null,
  broker: full,
  insuredName: 'Acme Films, LLC',
  jobName: 'Untitled Feature',
})
check('the draft greets the named agent', draft.message.startsWith('Hi Jane,'))
check('the draft names the broker’s own client', draft.message.includes('Acme Films, LLC'))
check('the draft names the rental', draft.message.includes('Untitled Feature'))
check('every ask appears as a bullet', draft.issues.length > 0 && draft.issues.every((i) => draft.message.includes(`• ${i}`)))
check('the draft names the certificate holder', draft.message.includes('SirReel Production Vehicles, Inc.'))
// The link is appended by the route, never by the draft — a reviewer editing
// the body cannot delete the thing the email exists to deliver.
check('the draft carries no link', !/https?:\/\//.test(draft.message))
check(
  'the link block names the page and where it goes back',
  brokerReviewLinkLines('https://tsx.sirreel.com/coi/broker/t').includes('https://tsx.sirreel.com/coi/broker/t'),
)
// The sample certificate 404s until an admin uploads the PDF, so the email
// promises it only when one is on file — a dead sample costs the round trip
// this whole feature exists to save.
check(
  'the email names the sample only when one is on file',
  brokerReviewLinkLines('https://x/t', { hasSample: true }).join(' ').includes('sample certificate') &&
    !brokerReviewLinkLines('https://x/t', { hasSample: false }).join(' ').includes('sample') &&
    !brokerReviewLinkLines('https://x/t').join(' ').includes('sample'),
)

const anon = buildBrokerFixDraft({
  ai: FAILING,
  match,
  policyExpiryDate: null,
  broker: readCoiBroker({ producer: { agency: 'Hub International' } }),
  insuredName: null,
  jobName: null,
})
check('no contact name falls back to "Hello,"', anon.message.startsWith('Hello,'))
check('no insured name still asks for something', anon.issues.length > 0)

const clean = buildBrokerFixDraft({
  ai: { certificateHolder: { pass: true }, generalLiability: { pass: true }, autoLiability: { pass: true }, autoPhysicalDamage: { pass: true }, additionalInsured: { pass: true }, lossPayee: { pass: true }, coverageDates: { pass: true }, policyExpiry: { pass: true, expired: false } },
  match,
  policyExpiryDate: null,
  broker: full,
  insuredName: 'Acme Films, LLC',
  jobName: null,
})
check('a passing certificate asks the broker for nothing', clean.issues.length === 0)

// ── The packet the link opens ──────────────────────────────────────────────
console.log('\n— what the link opens —')

// No sample PDF uploaded: the page must offer nothing rather than a 404.
const gearOnlySampleless = buildBrokerReviewPacket({
  ai: FAILING,
  match,
  policyExpiryDate: null,
  insuredName: null,
  jobLabel: null,
  approved: false,
  uploadUrl: null,
})

const packet = buildBrokerReviewPacket({
  ai: FAILING,
  match,
  policyExpiryDate: new Date('2026-12-31T00:00:00Z'),
  insuredName: 'Acme Films, LLC',
  jobLabel: 'Untitled Feature',
  approved: false,
  uploadUrl: 'https://tsx.sirreel.com/coi/tok',
  replacementSentence: 'Replacement value of the rented equipment on this order: $84,000.',
  sampleUrl: 'https://sirreel.com/api/public/forms/coi',
})
check('the packet carries the same asks as the email', packet.issues.join('|') === draft.issues.join('|'))
check('the packet carries a verdict per requirement', packet.checks.length === 15)
check('the packet names the certificate holder', packet.holder.name === 'SirReel Production Vehicles, Inc.')
check('the packet carries the way back', packet.uploadUrl === 'https://tsx.sirreel.com/coi/tok')
check('the packet carries the sample certificate', packet.sampleUrl === 'https://sirreel.com/api/public/forms/coi')
check('an unset forms slot offers no sample', gearOnlySampleless.sampleUrl === null)
// The disclosure envelope. A row's `note` is model prose about the document
// and it names requirements this job may not even have — the same leak the
// client-facing draft was fixed for on 2026-09-09. The summary `notes` field
// is the same prose one level up. Neither is carried; what the broker reads
// is the ask list, which is written by us.
check(
  'no per-check note reaches the broker',
  packet.checks.every((c) => !Object.prototype.hasOwnProperty.call(c, 'note')) &&
    !JSON.stringify(packet).includes('Model prose naming requirements'),
)
check(
  'the review’s summary prose is not carried as a field',
  !JSON.stringify(packet).includes('Internal read of the document'),
)
const keys = new Set(Object.keys(packet))
check(
  'the packet exposes only the agreed fields',
  [...keys].every((k) =>
    [
      'insuredName', 'jobLabel', 'policyExpiryDate', 'issues', 'checks',
      'resolved', 'holder', 'uploadUrl', 'replacementSentence', 'sampleUrl',
    ].includes(k),
  ),
)

// A gear-only job's auto rows are NOT a failure to explain to a broker.
const gearOnly = buildBrokerReviewPacket({
  ai: FAILING,
  match,
  policyExpiryDate: null,
  ctx: { vehiclesOnJob: false },
  insuredName: 'Acme Films, LLC',
  jobLabel: null,
  approved: false,
  uploadUrl: null,
})
check(
  'no truck on the job means no auto ask on the broker page',
  gearOnly.checks.filter((c) => c.key === 'autoPhysicalDamage').every((c) => c.status === 'NA') &&
    !gearOnly.issues.some((i) => /physical damage/i.test(i)),
)

// Opened after the desk approved it: the broker reads "resolved", not a
// closed ask they cannot act on.
const resolved = buildBrokerReviewPacket({
  ai: FAILING,
  match,
  policyExpiryDate: null,
  insuredName: 'Acme Films, LLC',
  jobLabel: null,
  approved: true,
  uploadUrl: null,
})
check('an approved certificate reads as resolved', resolved.resolved === true)

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All COI broker-review checks passed.')
