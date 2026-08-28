/**
 * Unsubscribe token tests.
 *
 *   npm run test:unsubscribe-token
 *
 * Pure + offline apart from an env var. This token is the only thing
 * standing between "anyone can unsubscribe anyone" and a working opt-out
 * link, so the forgery cases matter more than the happy path.
 */

process.env.OUTREACH_UNSUBSCRIBE_SECRET = 'test-secret-not-a-real-one'

import { mintUnsubscribeParts, verifyUnsubscribeToken } from '../../src/lib/outreach/unsubscribeToken'

const failures: string[] = []
function check(cond: boolean, why: string) {
  console.log(cond ? `  ok — ${why}` : `  FAIL — ${why}`)
  if (!cond) failures.push(why)
}

console.log('\nRound trip')
{
  const parts = mintUnsubscribeParts('Producer@Example.com')
  const back = verifyUnsubscribeToken(parts.e, parts.t)
  check(back === 'producer@example.com', 'verifies, and normalizes case on the way back')
}

console.log('\nForgery is rejected')
{
  const mine = mintUnsubscribeParts('victim@example.com')
  const other = mintUnsubscribeParts('attacker@example.com')
  check(verifyUnsubscribeToken(mine.e, other.t) === null,
    'a signature minted for another address does not validate')
  check(verifyUnsubscribeToken(mine.e, mine.t.slice(0, -1) + 'A') === null,
    'a tampered signature does not validate')
  check(verifyUnsubscribeToken(Buffer.from('someoneelse@example.com').toString('base64url'), mine.t) === null,
    'swapping the payload under a valid signature does not validate')
  check(verifyUnsubscribeToken(mine.e, 'short') === null,
    'a wrong-length signature is rejected without throwing')
}

console.log('\nMalformed input')
check(verifyUnsubscribeToken(null, null) === null, 'both missing')
check(verifyUnsubscribeToken('abc', null) === null, 'signature missing')
check(verifyUnsubscribeToken(null, 'abc') === null, 'payload missing')
check(verifyUnsubscribeToken('', '') === null, 'empty strings')
{
  // A validly-signed payload that is not an address must still fail —
  // a signature over garbage is a real signature.
  const notAnEmail = Buffer.from('not-an-email').toString('base64url')
  const parts = mintUnsubscribeParts('x@y.com')
  void parts
  const signed = mintUnsubscribeParts('placeholder@example.com')
  void signed
  check(verifyUnsubscribeToken(notAnEmail, 'anything') === null,
    'a payload that is not an email address is rejected')
}

console.log('\nStability')
{
  const a = mintUnsubscribeParts('same@example.com')
  const b = mintUnsubscribeParts('SAME@example.com')
  check(a.e === b.e && a.t === b.t,
    'the same address always mints the same link, so a resend does not invalidate an older one')
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`)
  failures.forEach((f) => console.error(`  - ${f}`))
  process.exit(1)
}
console.log('\nAll unsubscribe-token tests passed.\n')
