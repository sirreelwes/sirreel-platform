/**
 * Hand-recorded payments: the received day, and how-paid wording.
 *
 *   npx tsx tests/payments/manual-received-at.test.ts
 *   npm run test:manual-payment
 *
 * Pure + offline. Ana marks a Zelle/wire/ACH paid from Collections; both
 * directions of a wrong day cost something:
 *
 *   - Stored as UTC midnight, today's Zelle lands in YESTERDAY's EOD report
 *     and reads a day early on the order page.
 *   - Defaulted to the UTC date, an evening entry is refused as "future" or
 *     filed under tomorrow.
 */

import { manualReceivedAt } from '../../src/lib/invoices/manualReceivedAt'
import { pacificDayRange } from '../../src/lib/collections/eodReport'
import {
  MANUAL_PAYMENT_METHODS,
  pacificTodayYmd,
  paidViaLabel,
} from '../../src/lib/invoices/paymentMethods'

const failures: string[] = []

function check(ok: boolean, why: string, detail = ''): void {
  if (ok) console.log(`  ok — ${why}`)
  else failures.push(`${why}${detail ? `: ${detail}` : ''}`)
}

function lands(ymd: string, now: string, why: string): void {
  const r = manualReceivedAt(ymd, new Date(now))
  if (!r.ok) return check(false, why, r.error)
  const { start, end } = pacificDayRange(ymd)
  check(r.at >= start && r.at < end, why, `${ymd} → ${r.at.toISOString()}`)
}

console.log('Received day\n')

const MORNING = '2026-09-11T16:00:00.000Z' // 9am PDT, 9/11
const EVENING = '2026-09-12T05:30:00.000Z' // 10:30pm PDT, 9/11 — already 9/12 in UTC

{
  const r = manualReceivedAt('2026-09-11', new Date(MORNING))
  check(r.ok && r.at.getTime() === Date.parse(MORNING), 'today is stamped now')
}
{
  const r = manualReceivedAt('2026-09-11', new Date(EVENING))
  check(r.ok && r.at.getTime() === Date.parse(EVENING), 'today at 10:30pm Pacific is still today')
}
check(pacificTodayYmd(new Date(EVENING)) === '2026-09-11', 'the form defaults to the Pacific day, not the UTC one')
check(!manualReceivedAt('2026-09-12', new Date(EVENING)).ok, 'the UTC date at 10:30pm Pacific is the future — refused')
check(!manualReceivedAt('2026-10-01', new Date(MORNING)).ok, 'a later day is refused')

lands('2026-09-10', MORNING, 'yesterday lands inside yesterday (not the afternoon before)')
lands('2026-03-08', MORNING, 'spring-forward day lands inside the day')
lands('2026-11-01', '2026-11-20T18:00:00.000Z', 'fall-back day lands inside the day')
lands('2026-01-15', MORNING, 'a winter (PST) day lands inside the day')

{
  const r = manualReceivedAt(undefined, new Date(MORNING))
  check(r.ok && r.at.getTime() === Date.parse(MORNING), 'blank means now')
}
check(!manualReceivedAt('2026-02-30', new Date(MORNING)).ok, 'an impossible day is refused, not rolled into March')
check(!manualReceivedAt('9/11/2026', new Date(MORNING)).ok, 'a US-format date is refused')
check(!manualReceivedAt(20260911, new Date(MORNING)).ok, 'a number is refused')

console.log('\nHow it was paid\n')

check(paidViaLabel(['ZELLE']) === 'Zelle', 'one method reads as its name')
check(paidViaLabel(['WIRE', 'CARDPOINTE', 'CREDIT_CARD', 'WIRE']) === 'Wire + Card', 'distinct methods, cards read as Card')
check(paidViaLabel([]) === null, 'no payments, no label')
check(
  !MANUAL_PAYMENT_METHODS.some((m) => (m as string) === 'CARDPOINTE' || (m as string) === 'CREDIT_CARD'),
  'a card cannot be marked paid by hand — it is charged',
)
check(
  (['ZELLE', 'WIRE', 'ACH'] as const).every((m) => MANUAL_PAYMENT_METHODS.includes(m)),
  'Zelle, wire and ACH are all offered',
)

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\nall passed')
