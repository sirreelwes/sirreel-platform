/**
 * Card-on-file expiry flag.
 *
 *   npx tsx tests/payments/company-card-expiry.test.ts
 *   npm run test:card-expiry
 *
 * Pure + offline. The wallet marks a card expired so staff don't promise a
 * client a charge that will decline. Both directions cost something:
 *
 *   - A false EXPIRED trains staff to ignore the badge, which makes the real
 *     ones invisible.
 *   - A missed EXPIRED is a charge attempt on a dead card during collections.
 *
 * A card is good through the END of its expiry month — the classic off-by-one
 * here retires a card on the 1st of the month it is still valid for.
 */

import { isExpiryPast } from '../../src/lib/payments/companyCards'

const failures: string[] = []

function check(expiry: string | null, now: string, want: boolean, why: string): void {
  const got = isExpiryPast(expiry, new Date(now))
  if (got === want) console.log(`  ok — ${why}`)
  else failures.push(`${why}: ${expiry} as of ${now} → ${got}, wanted ${want}`)
}

console.log('Card expiry (MMYY)\n')

// Good through the last day of the expiry month.
check('0626', '2026-06-01T00:00:00Z', false, '06/26 on June 1 2026 is still good')
check('0626', '2026-06-30T23:59:59Z', false, '06/26 on the last day of June is still good')
check('0626', '2026-07-01T00:00:00Z', true, '06/26 has expired by July 1')
check('1226', '2026-12-31T23:59:59Z', false, '12/26 good through New Year’s Eve')
check('1226', '2027-01-01T00:00:00Z', true, '12/26 expired in the new year')
check('0130', '2026-09-01T00:00:00Z', false, 'far-future card is fine')

// Unknown is not evidence of expiry — never flag what we can't read.
check(null, '2026-09-01T00:00:00Z', false, 'no expiry recorded → not flagged')
check('', '2026-09-01T00:00:00Z', false, 'empty expiry → not flagged')
check('6/26', '2026-09-01T00:00:00Z', false, 'unparseable format → not flagged')
check('9999', '2026-09-01T00:00:00Z', false, 'month 99 is not a month → not flagged')
check('0026', '2026-09-01T00:00:00Z', false, 'month 00 is not a month → not flagged')

console.log('')
if (failures.length) {
  console.error(`FAILED (${failures.length}):`)
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('All card-expiry cases pass.')
