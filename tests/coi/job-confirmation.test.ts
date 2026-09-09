/**
 * "Active COI on file — is it the right one for THIS job?"
 *
 *   npx tsx tests/coi/job-confirmation.test.ts
 *   npm run test:coi-confirmation
 *
 * Offline: the DB is a stub, so this tests the RULES, not Prisma.
 *
 * Two directions of wrongness matter here, and they pull opposite ways:
 *
 *   - An unconfirmed job must never read as UNINSURED. The account cert is
 *     real coverage; treating an unanswered question as a failure sends the
 *     desk chasing a document HQ already holds — the exact harm the
 *     carry-forward was built to stop.
 *   - A job the client told us runs on its OWN policy must never read as
 *     insured by the account cert. That is the case the whole feature
 *     exists for; getting it wrong sends a truck out on a certificate that
 *     does not name the production.
 */
import {
  getJobCoiConfirmation,
  carriedCoiApplies,
  separatePolicySentence,
  confirmationAcknowledgment,
  NO_CONFIRMATION,
} from '../../src/lib/coi/jobCoiConfirmation'
import type { JobCoiResolution } from '../../src/lib/coi/companyCoi'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

/** Minimal stand-in for the fields the module reads off a resolution. */
function resolution(coiId: string, source: 'JOB' | 'COMPANY'): JobCoiResolution {
  return {
    coi: {
      id: coiId,
      originalFilename: 'Account COI.pdf',
      policyExpiryDate: new Date('2027-06-30T00:00:00.000Z'),
    },
    source,
    expiresDuringRental: null,
  } as unknown as JobCoiResolution
}

/** A db stub returning one stored answer (or none). */
function db(row: Record<string, unknown> | null) {
  return { jobCoiConfirmation: { findUnique: async () => row } } as never
}

const CERT = 'coi-1'
const NEWER = 'coi-2'

async function main() {
  // ── The job's own certificate is never questioned ──────────────────
  const own = await getJobCoiConfirmation('job-1', resolution(CERT, 'JOB'), db({ decision: 'SEPARATE_POLICY' }))
  check('a job-uploaded certificate is NOT_APPLICABLE, even with a stored answer', own.state === 'NOT_APPLICABLE')

  // ── Carried + unanswered = an open question, not a failure ─────────
  const unanswered = await getJobCoiConfirmation('job-1', resolution(CERT, 'COMPANY'), db(null))
  check('a carried, unanswered certificate reads NEEDED', unanswered.state === 'NEEDED')
  check('…and still counts as coverage', carriedCoiApplies(unanswered))

  // ── Confirmed about THIS certificate ───────────────────────────────
  const confirmed = await getJobCoiConfirmation(
    'job-1',
    resolution(CERT, 'COMPANY'),
    db({ decision: 'CONFIRMED', coiCheckId: CERT, decidedAt: new Date(), confirmerName: 'Emily', note: null }),
  )
  check('confirmed about the governing certificate reads CONFIRMED', confirmed.state === 'CONFIRMED')
  check('…and is not flagged as superseded', !confirmed.aboutSupersededCoi)

  // ── Confirmed about a certificate that has since been replaced ─────
  const stale = await getJobCoiConfirmation(
    'job-1',
    resolution(NEWER, 'COMPANY'),
    db({ decision: 'CONFIRMED', coiCheckId: CERT, decidedAt: new Date(), confirmerName: 'Emily', note: null }),
  )
  check('a confirmation about an older cert asks again', stale.state === 'NEEDED')
  check('…and says why it is asking again', stale.aboutSupersededCoi)
  check('…and the account cert still stands in meanwhile', carriedCoiApplies(stale))

  // ── The exception this whole feature exists for ────────────────────
  const separate = await getJobCoiConfirmation(
    'job-1',
    resolution(CERT, 'COMPANY'),
    db({ decision: 'SEPARATE_POLICY', coiCheckId: CERT, decidedAt: new Date(), confirmerName: 'Emily', note: 'Producer carries it' }),
  )
  check('a declared separate policy reads SEPARATE_POLICY', separate.state === 'SEPARATE_POLICY')
  check('…and the account certificate STOPS standing in', !carriedCoiApplies(separate))
  check(
    '…and it survives a NEWER account certificate',
    !carriedCoiApplies(
      await getJobCoiConfirmation(
        'job-1',
        resolution(NEWER, 'COMPANY'),
        db({ decision: 'SEPARATE_POLICY', coiCheckId: CERT, decidedAt: new Date(), confirmerName: null, note: null }),
      ),
    ),
  )
  // Silence would read as a client who simply never uploaded one.
  check('…and it always produces a sentence to render', separatePolicySentence(separate).length > 20)
  check('a confirmed job produces no separate-policy sentence', separatePolicySentence(confirmed) === '')

  // ── Nothing on file at all: the ask is for the certificate itself ──
  const nothing = await getJobCoiConfirmation('job-1', null, db(null))
  check('no certificate anywhere is NOT_APPLICABLE, not NEEDED', nothing.state === 'NOT_APPLICABLE')
  check('the empty view is safe to render', NO_CONFIRMATION.state === 'NOT_APPLICABLE')

  // ── What we store as having been said ──────────────────────────────
  const ack = confirmationAcknowledgment('Fox Sports', 'Fox Sports COI.pdf', new Date('2027-06-30T00:00:00.000Z'))
  check('the acknowledgment names the document', ack.includes('Fox Sports COI.pdf'))
  check('…the account', ack.includes('Fox Sports'))
  check('…and the date they were shown', ack.includes('June 30, 2027'))

  console.log('')
  if (failures.length) {
    console.error(`${failures.length} failure(s):`)
    for (const f of failures) console.error(`  ✗ ${f}`)
    process.exit(1)
  }
  console.log('All job-COI-confirmation checks passed.')
}

main()
