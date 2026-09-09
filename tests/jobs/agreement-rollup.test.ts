/**
 * Job agreement rollup — is this job papered, across ALL its orders?
 *
 *   npx tsx tests/jobs/agreement-rollup.test.ts
 *   npm run test:agreement-rollup
 *
 * Pure + offline: no DB, no env.
 *
 * Why it is guarded: this one function is now the only answer three
 * surfaces give — the /jobs tile chip, the job page's paperwork strip, and
 * the warehouse pickup picklist — and both failure directions cost real
 * money:
 *
 *   - A false SIGNED stops chasing a signature nobody ever gave. Gear rolls
 *     out papered by nothing.
 *   - A false PARTIAL is what sent us here (SR-JOB-0294, 2026-09-09): a
 *     two-order job, signed once, showing a red "Missing: Agreement" chip
 *     that no one could ever clear, because the second order had no
 *     agreement row for `applyJobCoverage` to stamp.
 */

import { rollupJobAgreement, type AgreementOrderInput } from '../../src/lib/jobs/agreementRollup'

const failures: string[] = []

function check(orders: AgreementOrderInput[], want: string, why: string): void {
  const got = rollupJobAgreement(orders).state
  if (got === want) {
    console.log(`  ok — ${why}`)
  } else {
    failures.push(`${why}: got ${got}, wanted ${want}`)
  }
}

const CO = 'company-1'
const OTHER_CO = 'company-2'

const order = (
  id: string,
  rows: { status: string; coveredByAgreementId?: string | null }[] = [],
  companyId: string | null = CO,
): AgreementOrderInput => ({ id, companyId, rows })

const signed = { status: 'SIGNED_BASELINE' }
const signedOffline = { status: 'SIGNED_OFFLINE' }
const released = { status: 'PORTAL_RELEASED' }
const generated = { status: 'PORTAL_GENERATED' }

console.log('Job agreement rollup\n')

// ── Single order — the ordinary cases ─────────────────────────────
check([order('o1')], 'NONE', 'one order, no agreement anywhere')
check([order('o1', [generated])], 'DRAFT', 'generated but never released')
check([order('o1', [released])], 'SENT', 'out for signature')
check([order('o1', [signed])], 'SIGNED', 'signed')
check([order('o1', [signedOffline])], 'SIGNED', 'filed offline still counts')
check([], 'NONE', 'no live orders at all')

// ── The multi-order case this exists for ──────────────────────────
// The agreement renders Job #, never an order number: one signature papers
// the job. The second order having NO row is the exact shape that used to
// pin the tile on PARTIAL — nothing existed for applyJobCoverage to stamp.
check([order('o1', [signed]), order('o2')], 'SIGNED', 'sibling signature papers a row-less order')
check(
  [order('o1', [signed]), order('o2', [released])],
  'SIGNED',
  'sibling signature papers an unsigned row',
)
check(
  [order('o1', [signed]), order('o2', [{ status: 'PORTAL_RELEASED', coveredByAgreementId: 'a1' }])],
  'SIGNED',
  'already-stamped coverage still reads SIGNED',
)
check(
  [order('o1', [{ status: 'PORTAL_RELEASED', coveredByAgreementId: 'a1' }])],
  'SIGNED',
  'stamped row alone — the signing order was cancelled off the job',
)

// ── Where it must still say no ────────────────────────────────────
check([order('o1', [released]), order('o2', [released])], 'SENT', 'two orders, neither signed')
check([order('o1'), order('o2')], 'NONE', 'two orders, no paperwork at all')

// The same-company rule (mirrors findJobCoverage). A production company
// corrected after a COI mismatch moves the job + its orders; a signature
// made under the OLD entity must not paper an order booked under the new
// one — that is the failure the re-issue flow exists to fix.
check(
  [order('o1', [signed]), order('o2', [], OTHER_CO)],
  'PARTIAL',
  'signature under a different company does not paper the other order',
)
check(
  [order('o1', [signed]), order('o2', [], null)],
  'PARTIAL',
  'a company-less order is covered by nothing',
)

// PARTIAL is still reachable, and still means someone is owed something.
check(
  [order('o1', [signed]), order('o2', [released], OTHER_CO)],
  'PARTIAL',
  'one company signed, the other has not',
)

console.log('')
if (failures.length > 0) {
  console.error(`FAILED (${failures.length}):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All agreement-rollup checks passed.')
