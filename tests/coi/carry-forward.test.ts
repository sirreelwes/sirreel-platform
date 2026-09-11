/**
 * Which of an account's certificates carries forward to a job.
 *
 *   npx tsx tests/coi/carry-forward.test.ts
 *   npm run test:coi-carry
 *
 * Pure + offline: no DB, no env. `pickCarriedCoi` is the one picker the
 * /jobs list, the readiness batch and the job detail share, so a tile and
 * the page it opens onto cannot disagree about the account's certificate.
 *
 * Two directions of wrongness:
 *
 *   - Carrying an unreviewed certificate as COVERAGE. Rule 1 of
 *     lib/coi/companyCoi: nobody has checked it, so it must never read
 *     VERIFIED. Here that means `awaitingReview` is set, and it is only
 *     returned at all when the caller opted in.
 *
 *   - Reading "Missing" about a document HQ is holding. Echobend's annual
 *     certificate sat PENDING from 09-02 to 09-11 and every Echobend tile
 *     said COI missing (Wes: "Echobend has an annual COI on file").
 */

import { newestFullCoi, pickCarriedCoi } from '../../src/lib/coi/companyCoi'
import { rollupCoiState } from '../../src/lib/coi/coiState'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

const d = (s: string) => new Date(s)
const start = d('2026-09-22T00:00:00Z')
const end = d('2026-09-29T00:00:00Z')

type Cert = { id: string; humanDecision: string; policyExpiryDate: Date | null; namedInsured: string | null; coverageVerified: boolean }
const cert = (id: string, humanDecision: string, expiry: string | null, namedInsured: string | null = 'Echobend Pictures, LLC'): Cert => ({
  id,
  humanDecision,
  policyExpiryDate: expiry ? d(expiry) : null,
  namedInsured,
  coverageVerified: humanDecision === 'APPROVED',
})
const staff = { includeAwaitingReview: true, companyName: 'Echobend' }

console.log('Account certificate carry-forward\n')

// ── Approved always wins ───────────────────────────────────────────
{
  const p = pickCarriedCoi([cert('pend', 'PENDING', '2028-01-01'), cert('appr', 'APPROVED', '2027-03-08')], start, end, staff)
  check('approved full-span beats a longer-dated pending one', p?.coi.id === 'appr' && p.awaitingReview === false)
}
{
  const p = pickCarriedCoi([cert('pend', 'PENDING', '2028-01-01'), cert('appr', 'APPROVED', '2026-09-25')], start, end, staff)
  check('approved partial (lapses mid-rental) still beats pending full, gap named',
    p?.coi.id === 'appr' && p.awaitingReview === false && p.expiresDuringRental?.toISOString() === d('2026-09-25').toISOString())
}

// ── Unreviewed only on opt-in ──────────────────────────────────────
{
  const certs = [cert('pend', 'PENDING', '2027-03-08')]
  check('client/gate callers (no opt-in) get nothing for a pending cert', pickCarriedCoi(certs, start, end) === null)
  check('no opt-in, even with a company name', pickCarriedCoi(certs, start, end, { companyName: 'Echobend' }) === null)
  const p = pickCarriedCoi(certs, start, end, staff)
  check('staff opt-in carries it, flagged awaitingReview', p?.coi.id === 'pend' && p.awaitingReview === true)
  check('…and rollupCoiState reads it PENDING, never VERIFIED', !!p && rollupCoiState(p.coi).state === 'PENDING')
}
{
  const p = pickCarriedCoi([cert('c', 'COUNTERED', '2027-03-08')], start, end, staff)
  check('COUNTERED is "waiting on a person" too', p?.coi.id === 'c' && p.awaitingReview === true)
}

// ── The Echobend file: two harvested certs, one for somebody else ──
{
  const echobend = cert('echo', 'PENDING', '2027-03-08', 'ECHOBEND PICTURES, LLC')
  const cmp = cert('cmp', 'PENDING', '2027-03-31', 'CMP Film & Design Burbank, LLC')
  const p = pickCarriedCoi([cmp, echobend], start, end, staff)
  check('the certificate that insures THIS company beats a longer-dated one for another entity', p?.coi.id === 'echo')
  const only = pickCarriedCoi([cmp], start, end, staff)
  check('…but a lone mismatched cert is still surfaced (the page flags the mismatch)', only?.coi.id === 'cmp')
  const partialEcho = cert('echo', 'PENDING', '2026-09-25', 'ECHOBEND PICTURES, LLC')
  const p2 = pickCarriedCoi([cmp, partialEcho], start, end, staff)
  check('a matching cert that lapses mid-rental still beats a mismatched full-span one', p2?.coi.id === 'echo' && !!p2.expiresDuringRental)
}

// ── Never carried ──────────────────────────────────────────────────
check('REJECTED is never carried', pickCarriedCoi([cert('r', 'REJECTED', '2027-03-08')], start, end, staff) === null)
check('no expiry date, no carry-forward', pickCarriedCoi([cert('n', 'APPROVED', null)], start, end, staff) === null)
check('lapsed before the job starts is not coverage', pickCarriedCoi([cert('old', 'APPROVED', '2026-09-01')], start, end, staff) === null)
check('empty file → null', pickCarriedCoi([], start, end, staff) === null)

// ── Workers' comp on its own never governs (MNX, 2026-09-11) ───────
{
  const wcReview = { generalLiability: { found: '' }, workersComp: { found: 'WC 080772104, E.L. $1,000,000' } }
  const glReview = { generalLiability: { pass: true, perOccurrence: { found: '$1,000,000' } }, workersComp: { found: 'Policy 7997-9687' } }
  const approvedWc = { ...cert('wc', 'APPROVED', '2028-01-01', 'TakeOne Network Corp.'), aiResponse: wcReview }
  const approvedGl = { ...cert('gl', 'APPROVED', '2027-08-24', 'Chaotic Neutral LTD'), aiResponse: glReview }
  check("an account's approved workers' comp cert is never carried, even longer-dated", pickCarriedCoi([approvedWc, approvedGl], start, end, staff)?.coi.id === 'gl')
  check("workers' comp alone carries nothing", pickCarriedCoi([approvedWc], start, end, staff) === null)
  check("the newest FULL cert governs over a newer workers' comp upload (MNX)", newestFullCoi([approvedWc, approvedGl])?.id === 'gl')
  check("only workers' comp on the job → no certificate of its own (LAFSC)", newestFullCoi([approvedWc]) === null)
  check('a row with no AI review still counts as a certificate', newestFullCoi([{ ...cert('old', 'APPROVED', '2027-01-01'), aiResponse: null }])?.id === 'old')
}

console.log('')
if (failures.length) {
  console.error(`FAILED (${failures.length}):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('all passed')
