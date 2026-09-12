/**
 * What the client portal says about the desk's decision on a certificate.
 *
 *   npx tsx tests/coi/client-decision.test.ts
 *   npm run test:coi-client-decision
 *
 * Pure + offline. Origin (2026-09-12): a "Request fix" on No Slate's
 * certificate parked the row as COUNTERED; the portal only knew APPROVED
 * and REJECTED, so Justin's page kept saying "Reviewing" while the desk
 * showed the same row as rejected. The badge must never call a fix
 * request a review-in-progress, and must never call it a rejection either.
 */

import { coiClientDecision } from '../../src/lib/coi/coiState'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

console.log('COI client decision\n')

const countered = coiClientDecision('COUNTERED', false, '2026-09-12T18:31:37.196Z')
check('COUNTERED is not "Reviewing"', countered.label !== 'Reviewing')
check('COUNTERED is not "Rejected"', countered.label !== 'Rejected')
check('COUNTERED asks for a correction', countered.label === 'Correction needed' && countered.kind === 'warning')
check('COUNTERED sentence dates the email in Pacific time', countered.notice.includes('on September 12'))
check('COUNTERED sentence tells them to upload the corrected certificate', /upload it here/.test(countered.notice))

const counteredUndated = coiClientDecision('COUNTERED', false, null)
check('COUNTERED without a timestamp still reads whole', /emailed you with/.test(counteredUndated.notice))

const rejected = coiClientDecision('REJECTED', false)
check('REJECTED is failed + explained', rejected.label === 'Rejected' && rejected.kind === 'failed' && rejected.notice.length > 0)

const approved = coiClientDecision('APPROVED', true)
check('APPROVED is a clean success', approved.label === 'Approved' && approved.kind === 'success' && approved.notice === '')

const received = coiClientDecision('PENDING', true)
check('PENDING with AI coverage reads Received', received.label === 'Received' && received.kind === 'success')

const reviewing = coiClientDecision('PENDING', false)
check('PENDING without coverage reads Reviewing, nothing more', reviewing.label === 'Reviewing' && reviewing.kind === 'pending' && reviewing.notice === '')

// A fix request is never a sign-off — the route also clears coverageVerified,
// but the derivation must not depend on that.
const counteredVerified = coiClientDecision('COUNTERED', true)
check('COUNTERED beats a stale coverageVerified', counteredVerified.label === 'Correction needed')

console.log('')
if (failures.length) {
  console.error(`FAILED (${failures.length}):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('all passed')
