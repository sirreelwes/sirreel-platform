/**
 * A cancelled partner booking leaves a line off the pick list — the warning.
 *
 *   npm run test:partner-cancelled-lines
 *
 * Pure + offline. Wes 2026-09-11: partner lines stay off the pick list, and
 * "there needs to be a warning wired in" for the line a partner cancels and
 * SirReel then fills from its own shelf.
 */
import { partnerCancelledPriority, PARTNER_CANCELLED_LINE_WHERE, WAREHOUSE_WORKING } from '../../src/lib/orders/partnerCancelledLines'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) console.log(`  ok — ${why}`)
  else failures.push(`${why}: got ${g}, wanted ${w}`)
}

const now = new Date(2026, 8, 11, 15, 0) // Sep 11 2026, local afternoon
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))

console.log('How loud')
eq(partnerCancelledPriority('ON_JOB', day(2026, 12, 1), now), 'high', 'on the job: high whatever the date')
eq(partnerCancelledPriority('LOADED_READY', day(2026, 12, 1), now), 'high', 'loaded: high')
eq(partnerCancelledPriority('BOOKED', day(2026, 9, 14), now), 'high', 'booked, picking up in 3 days: high')
eq(partnerCancelledPriority('BOOKED', day(2026, 9, 11), now), 'high', 'booked, picking up today: high')
eq(partnerCancelledPriority('BOOKED', day(2026, 9, 15), now), 'medium', 'booked, 4 days out: medium')
eq(partnerCancelledPriority('APPROVED', day(2026, 10, 1), now), 'medium', 'pull order released, weeks out: medium')

console.log('What waits')
const and = (PARTNER_CANCELLED_LINE_WHERE.AND ?? []) as Record<string, unknown>[]
eq(and.find((c) => 'type' in c), { type: { notIn: ['FEE', 'DISCOUNT', 'LABOR'] } }, 'physical gear only — fees, discounts and labor are never pulled')
eq(and.find((c) => 'fulfillmentLane' in c), { fulfillmentLane: null }, 'only a line with no lane')
eq(and.some((c) => 'NOT' in c), true, 'never while a partner booking is live')
eq(WAREHOUSE_WORKING, ['BOOKED', 'LOADED_READY', 'ON_JOB'], 'the warehouse is working booked, loaded and on-job orders')

if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\nall partner-cancelled-line checks passed')
