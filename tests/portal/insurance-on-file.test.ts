/**
 * "Do we still need insurance paperwork from this client?" — the pure rule.
 *
 * Christopher Helmic, first time through the portal on Pilot Pen
 * (2026-09-18): "The CC section requires us to add the COI again, plus the WC
 * (which is requested but it doesn't feature a separate upload section on the
 * first page)."
 *
 * The expensive direction here is a false ASK: the client has sent everything,
 * the portal says otherwise, and they either upload the same PDF twice or
 * write to their rep asking whether the thing they did worked. The other
 * direction — a false "nothing needed" — is worse still in one specific case
 * and is pinned separately: a REJECTED or lapsed certificate is not proof, and
 * telling a client there is nothing to upload would leave a truck going out
 * against a certificate we refused.
 *
 *   npm run test:portal-insurance
 */
import { insuranceStepState, type InsuranceCertificate } from '../../src/lib/portal/insuranceRules'
import { coiCarriesWorkersComp } from '../../src/lib/coi/checks'

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name}`, detail ?? '')
  }
}

const NOW = new Date('2026-09-18T12:00:00Z')

/** A review shaped like the ones the portal and the drop link store. */
const review = (wc: boolean | undefined) => ({
  generalLiability: { pass: true, found: '$1M / $2M' },
  autoLiability: { pass: true, found: '$1M CSL' },
  ...(wc === undefined ? {} : { workersComp: { pass: wc, found: wc ? '$1M each accident' : '' } }),
})

const cert = (o: Partial<InsuranceCertificate> = {}): InsuranceCertificate => ({
  source: 'JOB',
  filename: 'pilot-pen-coi.pdf',
  uploadedAt: '2026-09-17T18:00:00Z',
  humanDecision: 'PENDING',
  policyExpiryDate: '2027-03-01T00:00:00Z',
  aiResponse: review(true),
  ...o,
})

const bare = { coiReceived: false, wcReceived: false }

console.log('\n— the certificate the job already holds —')
// The whole complaint: the job portal files against the JOB, the paperwork
// portal read its own row's boolean, so the second screen asked for the
// document the first screen had taken ten minutes earlier.
{
  const s = insuranceStepState({ ...bare, certificate: cert() }, NOW)
  check('a job certificate answers the COI ask', s.coi.satisfied && s.coi.proof === 'JOB')
  check('and names the file so the client can tell which one', s.coi.note.includes('pilot-pen-coi.pdf'), s.coi.note)
}
check(
  'the account’s carried certificate answers it too',
  insuranceStepState({ ...bare, certificate: cert({ source: 'COMPANY' }) }, NOW).coi.proof === 'COMPANY',
)
check(
  'nothing on file is still an ask',
  insuranceStepState(bare, NOW).coi.satisfied === false,
)
check(
  'this row’s own flag still answers it',
  insuranceStepState({ coiReceived: true, wcReceived: false }, NOW).coi.proof === 'REQUEST',
)

console.log('\n— a certificate in review counts; a refused one does not —')
// Handing it over is the client's part. Reviewing it is ours, and asking them
// to upload it again while it sits in our queue is the double-ask itself.
check('PENDING counts', insuranceStepState({ ...bare, certificate: cert({ humanDecision: 'PENDING' }) }, NOW).coi.satisfied)
check('APPROVED counts', insuranceStepState({ ...bare, certificate: cert({ humanDecision: 'APPROVED' }) }, NOW).coi.satisfied)
// The desk has told them, in those words, that a new one is owed
// (lib/coi/coiState's coiClientDecision) — so the portal must keep asking.
check(
  'REJECTED does not',
  insuranceStepState({ ...bare, certificate: cert({ humanDecision: 'REJECTED' }) }, NOW).coi.satisfied === false,
)
check(
  'a fix request (COUNTERED) does not',
  insuranceStepState({ ...bare, certificate: cert({ humanDecision: 'COUNTERED' }) }, NOW).coi.satisfied === false,
)
check(
  'a lapsed policy does not',
  insuranceStepState(
    { ...bare, certificate: cert({ humanDecision: 'APPROVED', policyExpiryDate: '2026-09-01T00:00:00Z' }) },
    NOW,
  ).coi.satisfied === false,
)
check(
  'expiring later today still does',
  insuranceStepState(
    { ...bare, certificate: cert({ policyExpiryDate: '2026-09-18T23:00:00Z' }) },
    NOW,
  ).coi.satisfied,
)
check(
  'an undated certificate is not treated as expired',
  insuranceStepState({ ...bare, certificate: cert({ policyExpiryDate: null }) }, NOW).coi.satisfied,
)

console.log('\n— workers’ comp rides on the COI —')
// `wc_received` was written by ONE route, the separate-WC upload. Workers'
// comp is normally on the ACORD itself, so for the ordinary client the flag
// could never become true and the insurance step could never close.
check('the review says so → satisfied', coiCarriesWorkersComp(review(true) as never))
check('and it is read off the request’s own review', insuranceStepState({ ...bare, requestCoiReview: review(true) }, NOW).wc.proof === 'ON_COI')
check(
  'and off the job’s certificate',
  insuranceStepState({ ...bare, certificate: cert({ aiResponse: review(true) }) }, NOW).wc.proof === 'ON_COI',
)
check(
  'the note says no separate upload is needed',
  insuranceStepState({ ...bare, requestCoiReview: review(true) }, NOW).wc.note.includes('no separate upload'),
)
// The other direction: a certificate that shows no workers' comp must still
// produce the ask, or a production with no WC coverage sails through.
check(
  'a certificate WITHOUT workers’ comp still asks',
  insuranceStepState({ ...bare, requestCoiReview: review(false) }, NOW).wc.satisfied === false,
)
// "Never asked" is not "asked and blank" — an older review that never carried
// the key has confirmed nothing (lib/coi/checks: UNKNOWN is never a pass).
check(
  'a review that never looked at WC is not a pass',
  insuranceStepState({ ...bare, requestCoiReview: review(undefined) }, NOW).wc.satisfied === false,
)
check(
  'a payroll company’s separate certificate answers it',
  insuranceStepState(
    { ...bare, workersCompCertificate: { filename: 'ep-wc.pdf', uploadedAt: '2026-09-16T00:00:00Z' } },
    NOW,
  ).wc.proof === 'JOB',
)
check(
  'this row’s own flag still answers it',
  insuranceStepState({ coiReceived: false, wcReceived: true }, NOW).wc.proof === 'REQUEST',
)

console.log('\n— on file is not the same as approved —')
// The trap this fix could have walked into: closing the step on a certificate
// nobody has reviewed AND printing "Insurance Documents Approved" over it.
// Both portals choose their wording from `verified`, so the client is told
// the truth in either state.
{
  const pending = insuranceStepState({ ...bare, certificate: cert({ humanDecision: 'PENDING', coverageVerified: false }) }, NOW)
  check('an unreviewed certificate is nothing for the client to do', pending.coi.satisfied)
  check('but it is NOT verified', pending.coi.verified === false)
  check('and the note says it is with us for review', pending.coi.note.includes('for review'), pending.coi.note)
}
check(
  'critical checks passed → verified',
  insuranceStepState({ ...bare, certificate: cert({ coverageVerified: true }) }, NOW).coi.verified,
)
check(
  'a person approved it → verified',
  insuranceStepState({ ...bare, certificate: cert({ humanDecision: 'APPROVED' }) }, NOW).coi.verified,
)
check(
  'this row’s own coi_received means the critical checks passed',
  insuranceStepState({ coiReceived: true, wcReceived: false }, NOW).coi.verified,
)

console.log('\n— the step only closes when BOTH are in hand —')
check(
  'COI alone does not close it',
  insuranceStepState({ ...bare, certificate: cert({ aiResponse: review(false) }) }, NOW).complete === false,
)
check(
  'WC alone does not close it',
  insuranceStepState({ ...bare, wcReceived: true }, NOW).complete === false,
)
check(
  'one certificate carrying both closes it',
  insuranceStepState({ ...bare, certificate: cert({ aiResponse: review(true) }) }, NOW).complete,
)
// The exact shape Christopher was in: certificate uploaded on the job page,
// workers' comp on it, nothing recorded against the paperwork row. Before
// today this read as NOTHING done.
check(
  'the Pilot Pen case: nothing left to ask for',
  insuranceStepState({ coiReceived: false, wcReceived: false, certificate: cert() }, NOW).complete,
)

console.log(failures === 0 ? '\nAll insurance-on-file rules hold.\n' : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
