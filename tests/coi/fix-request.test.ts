/**
 * COI "what's still missing" draft tests.
 *
 *   npx tsx tests/coi/fix-request.test.ts
 *   npm run test:coi-fix-request
 *
 * Pure + offline: no DB, no AI, no env. This text is SENT TO A CLIENT, so
 * the cases that matter are the two directions of wrongness — asking for
 * something the certificate already has makes us look like we didn't read
 * it, and staying silent about a real gap is how an uninsured truck leaves
 * the yard.
 *
 * The unknown-vs-false distinction carries the weight: a review that never
 * extracted a field leaves it undefined, and an undefined field must NEVER
 * become a demand.
 */

import { buildCoiFixIssues, buildCoiFixDraft } from '../../src/lib/coi/fixRequest'
import { evaluateInsuredMatch } from '../../src/lib/coi/insuredMatch'

const failures: string[] = []

function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

const PASSING = {
  overallPass: true,
  coverageVerified: true,
  additionalInsured: true,
  autoPhysicalDamage: true,
  notes: '',
}
const noMatchIssue = evaluateInsuredMatch('Acme Films, LLC', ['Acme Films'])

console.log('COI fix-request draft\n')

// A clean certificate asks for nothing.
check(
  'a passing certificate produces no issues',
  buildCoiFixIssues({ ai: PASSING, match: noMatchIssue, policyExpiryDate: null }).length === 0,
)

// Each failed check earns exactly one bullet.
const limits = buildCoiFixIssues({
  ai: { ...PASSING, overallPass: false, coverageVerified: false },
  match: noMatchIssue,
  policyExpiryDate: null,
})
check('a limits failure asks for limits', limits.length === 1 && /General Liability/.test(limits[0]))

const hapd = buildCoiFixIssues({
  ai: { ...PASSING, overallPass: false, autoPhysicalDamage: false },
  match: noMatchIssue,
  policyExpiryDate: null,
})
check(
  'a physical-damage failure says liability alone is not enough',
  hapd.length === 1 && /physical damage/i.test(hapd[0]) && /not enough/.test(hapd[0]),
)

const ai_ = buildCoiFixIssues({
  ai: { ...PASSING, overallPass: false, additionalInsured: false },
  match: noMatchIssue,
  policyExpiryDate: null,
})
check(
  'an additional-insured failure names SirReel and the address',
  ai_.length === 1 && /8500 Lankershim/.test(ai_[0]) && /Loss Payee/.test(ai_[0]),
)

// THE case that must not regress: undefined ≠ false. A review filed before a
// field existed must not make us demand something we never checked.
const unknown = buildCoiFixIssues({
  ai: { overallPass: false, notes: 'Could not read the certificate.' },
  match: noMatchIssue,
  policyExpiryDate: null,
})
check(
  'unextracted fields do not become demands',
  unknown.length === 1 && unknown[0] === 'Could not read the certificate.',
)

// Expiry is a CALENDAR date — rendering it in local time reads back the day
// before the one printed on the certificate.
const expired = buildCoiFixIssues({
  ai: PASSING,
  match: noMatchIssue,
  policyExpiryDate: new Date('2020-01-01T00:00:00.000Z'),
  now: new Date('2026-01-01T00:00:00.000Z'),
})
check(
  'an expired policy is quoted on its printed date, not the day before',
  expired.length === 1 && /January 1, 2020/.test(expired[0]),
)
check(
  'a policy still in force is not called expired',
  buildCoiFixIssues({
    ai: PASSING,
    match: noMatchIssue,
    policyExpiryDate: new Date('2027-01-01T00:00:00.000Z'),
    now: new Date('2026-01-01T00:00:00.000Z'),
  }).length === 0,
)

// A named-insured mismatch is the client's to explain, and the copy must be
// the client-safe variant.
const mismatch = evaluateInsuredMatch('Contrast Films, LLC', ['JAP Productions'])
const withMismatch = buildCoiFixIssues({ ai: PASSING, match: mismatch, policyExpiryDate: null })
check(
  'a named-insured mismatch is raised with the client-safe wording',
  withMismatch.length === 1 && withMismatch[0] === mismatch.clientMessage,
)

// The assembled message.
const draft = buildCoiFixDraft({
  ai: { ...PASSING, overallPass: false, coverageVerified: false },
  match: noMatchIssue,
  policyExpiryDate: null,
  jobName: 'Untitled Feature',
  uploadUrl: 'https://tsx.sirreel.com/coi/tok',
  contactFirstName: 'Dana',
})
check('the message greets the contact', draft.message.startsWith('Hi Dana,'))
check('the message names the job', draft.message.includes('Untitled Feature'))
check('the message carries the upload link', draft.message.includes('https://tsx.sirreel.com/coi/tok'))
check('every issue appears as a bullet', draft.issues.every((i) => draft.message.includes(`• ${i}`)))

// Never send an empty ask, even with nothing extracted at all.
const bare = buildCoiFixDraft({
  ai: null,
  match: null,
  policyExpiryDate: null,
  jobName: null,
  uploadUrl: null,
})
check('a bare draft still asks for something', /corrected certificate/i.test(bare.message))

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All COI fix-request checks passed.')
