/**
 * The code that guards where a partner's mail goes.
 *
 *   npm run test:partner-action-code
 *
 * Pure + offline. Wes 2026-09-11, on the partner link being the credential:
 * "Is this a danger, a loop we should close?" It is forwardable, so moving the
 * main contact — or adding someone to booking mail — needs a code that only
 * reaches the address already on file.
 */
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-partner-codes'

import {
  maskEmail,
  needsMailRoutingCode,
  partnerActionCode,
  verifyPartnerActionCode,
} from '../../src/lib/sub-rentals/partnerActionCode'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  if (got === want) console.log(`  ok — ${why}`)
  else failures.push(`${why}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}

const VSM = '160e3f08-5c73-4efd-af0a-ee41edcddf2b'
const OTHER = 'd2992d4c-04ff-433c-8a9c-0a9155d9a427'
const now = 1_789_200_000_000

console.log('The code')
const code = partnerActionCode(VSM, 'mail-routing', now)
eq(/^\d{6}$/.test(code), true, 'six digits, leading zeros kept')
eq(verifyPartnerActionCode(VSM, 'mail-routing', code, now), true, 'the partner’s own code verifies')
eq(verifyPartnerActionCode(VSM, 'mail-routing', ` ${code} `, now), true, 'spaces a person types are ignored')
eq(verifyPartnerActionCode(OTHER, 'mail-routing', code, now), false, 'another partner’s code does not')
eq(verifyPartnerActionCode(VSM, 'mail-routing', '000000', now), false, 'a guess does not')
eq(verifyPartnerActionCode(VSM, 'mail-routing', '', now), false, 'empty does not')
eq(verifyPartnerActionCode(VSM, 'mail-routing', code, now + 9 * 60_000), true, 'still good nine minutes later')
eq(verifyPartnerActionCode(VSM, 'mail-routing', code, now + 25 * 60_000), false, 'dead after the window and the one after it')

console.log('When a code is required')
eq(needsMailRoutingCode({ isPrimary: true }), true, 'making someone the main contact')
eq(needsMailRoutingCode({ emailBookings: true }), true, 'copying someone on bookings')
eq(needsMailRoutingCode({ isPrimary: true }, { isPrimary: true }), false, 'already the main contact — nothing moved')
eq(needsMailRoutingCode({ emailBookings: false }, { emailBookings: true }), false, 'taking mail away needs no code')
eq(needsMailRoutingCode({}), false, 'a name or phone edit needs no code')

console.log('Telling them which inbox')
eq(maskEmail('vic@vsmplanetrentals.com'), 'v••@vsmplanetrentals.com', 'enough to recognise, not to learn')
eq(maskEmail('no-at-sign'), '•••', 'nonsense masks to nothing')

if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\nall partner action-code checks passed')
