/**
 * The staff preview of a client's job portal.
 *
 *   npm run test:job-preview
 *
 * Pure + offline. The property under test is the one that makes the feature
 * safe to have at all: a preview credential must never satisfy a real client
 * session, because that is what keeps every write route — sign, approve, pay,
 * name a driver — refusing it without their authors knowing this exists.
 */
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-job-preview'

import {
  createJobPreviewCookieValue,
  mintJobPreviewToken,
  readJobPreviewToken,
  verifyJobPreviewCookieValue,
} from '../../src/lib/portal/jobPreview'
import { createJobSessionCookieValue, verifyJobSessionCookieValue } from '../../src/lib/portal/jobSession'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  if (got === want) console.log(`  ok — ${why}`)
  else failures.push(`${why}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}

const ORDER = '0d5035eb-9f58-4ead-a9e8-db8eb81dfc18'
const WES = 'wes@sirreel.com'

console.log('The hand-off token')
const token = mintJobPreviewToken(ORDER, WES)
eq(readJobPreviewToken(token)?.orderId, ORDER, 'names the order it was minted for')
eq(readJobPreviewToken(token)?.by, WES, 'and who is looking')
eq(readJobPreviewToken(`${token}x`), null, 'a tampered token does not read')
eq(readJobPreviewToken(''), null, 'empty does not read')
eq(readJobPreviewToken(undefined), null, 'missing does not read')

console.log('The preview cookie')
const cookie = createJobPreviewCookieValue(ORDER, WES)
eq(verifyJobPreviewCookieValue(cookie)?.orderId, ORDER, 'round-trips the order')

console.log('A preview is NOT a client session')
// The whole safety story: every write route calls verifyJobSessionCookieValue,
// and it must refuse both the preview cookie and the hand-off token.
eq(verifyJobSessionCookieValue(cookie), null, 'the preview cookie cannot pass as a job session')
eq(verifyJobSessionCookieValue(token), null, 'neither can the hand-off token')

console.log('And a client session is NOT a preview')
const real = createJobSessionCookieValue('7c90ed9f-55d1-419a-b771-381d7f841066')
eq(verifyJobPreviewCookieValue(real), null, 'a real session does not read as a preview')
eq(verifyJobSessionCookieValue(real)?.portalAccessId, '7c90ed9f-55d1-419a-b771-381d7f841066', 'but still works as itself')

console.log('Expiry')
const stale = mintJobPreviewToken(ORDER, WES)
const realNow = Date.now
try {
  Date.now = () => realNow() + 11 * 60_000
  eq(readJobPreviewToken(stale), null, 'the hand-off token is dead after ten minutes')
  eq(verifyJobPreviewCookieValue(cookie)?.orderId, ORDER, 'the redeemed cookie outlives it (an hour)')
  Date.now = () => realNow() + 61 * 60_000
  eq(verifyJobPreviewCookieValue(cookie), null, 'and dies at the hour')
} finally {
  Date.now = realNow
}

if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\nall job-preview checks passed')
