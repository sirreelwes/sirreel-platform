/**
 * Walkies: one name for the client, one pool for HQ.
 *
 *   npx tsx tests/catalog/walkies.test.ts
 *   npm run test:walkies
 *
 * Pure, no DB. Wes 2026-09-15: nothing a client or the order form sees
 * says analog, digital or sub — and HQ, not a catalog row, decides when
 * walkies need subbing. The shortfall cases that matter are the quiet ones
 * as much as the loud ones: a banner that cries "sub 20" on an order that
 * is covered teaches the desk to ignore it.
 */

import {
  WALKIE_NAME,
  daysBetween,
  isStockOnlyCode,
  isWalkieFamilyCode,
  walkieClientName,
  walkieShortfall,
  type WalkieDemand,
} from '../../src/lib/catalog/walkies'

const failures: string[] = []
function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message)
  else console.log(`  ok — ${message}`)
}

console.log('\nthe name')
check(walkieClientName('Motorola CP200  UHF Radio (Analog)') === WALKIE_NAME, 'analog row name → Motorola CP200')
check(walkieClientName('Motorola CP200  UHF Radio (Digital)') === WALKIE_NAME, 'digital row name → Motorola CP200')
check(walkieClientName('Motorola CP200 UHF Radio (Sub)') === WALKIE_NAME, 'sub row name → Motorola CP200')
check(walkieClientName('Motorola CP200d  UHF Radio (Digital)') === WALKIE_NAME, 'archived CP200d spelling → Motorola CP200')
check(
  walkieClientName('Included with 12 × Motorola CP200  UHF Radio (Analog)') === 'Included with 12 × Motorola CP200',
  'kit-line note keeps its sentence, loses the radio type',
)
check(walkieClientName('Motorola CP200 6-Bank Charger') === 'Motorola CP200 6-Bank Charger', 'the charger keeps its name')
check(walkieClientName('Motorola CP200 Battery') === 'Motorola CP200 Battery', 'the battery keeps its name')
check(walkieClientName('Walkies') === 'Walkies', "a rep's own words are left alone")
check(walkieClientName(null) === null, 'null stays null')

console.log('\nthe rows')
check(isWalkieFamilyCode('104387') && isWalkieFamilyCode('103733'), 'digital and analog are both walkie stock')
check(isStockOnlyCode('103733') && !isStockOnlyCode('104387'), 'analog is stock-only, digital is the orderable row')
check(!isWalkieFamilyCode('CP200S'), 'the retired sub row is not stock')
check(!isStockOnlyCode(null), 'no code, not stock-only')

console.log('\ndays')
check(daysBetween('2026-09-14', '2026-09-16').length === 3, 'Sep 14→16 is 3 days, inclusive')
check(daysBetween('2026-09-16', '2026-09-14').length === 0, 'an inverted window is empty, not a crash')

console.log('\nthe pool')
const d = (orderId: string, quantity: number, start: string, end: string, hold: WalkieDemand['hold']): WalkieDemand =>
  ({ orderId, quantity, start, end, hold });

{
  const r = walkieShortfall({ pool: 378, orderId: 'A', demands: [d('A', 30, '2026-09-16', '2026-09-18', 'committed')], subs: [] })
  check(r.short === 0 && r.bookedAtPeak === 30, '30 of 378 is covered')
}
{
  const r = walkieShortfall({
    pool: 100, orderId: 'A',
    demands: [d('A', 60, '2026-09-16', '2026-09-17', 'committed'), d('B', 60, '2026-09-19', '2026-09-20', 'committed')],
    subs: [],
  })
  check(r.short === 0, 'back-to-back bookings that never overlap are not a conflict (per day, not summed)')
}
{
  const r = walkieShortfall({
    pool: 100, orderId: 'A',
    demands: [d('A', 60, '2026-09-16', '2026-09-18', 'committed'), d('B', 60, '2026-09-18', '2026-09-20', 'committed')],
    subs: [],
  })
  check(r.short === 20 && r.peakDay === '2026-09-18', 'one overlapping day is enough: sub 20 for Sep 18')
}
{
  const r = walkieShortfall({
    pool: 100, orderId: 'A',
    demands: [d('A', 60, '2026-09-16', '2026-09-18', 'quoted'), d('B', 60, '2026-09-16', '2026-09-18', 'committed')],
    subs: [],
  })
  check(r.short === 20, "a quote asks 'can THIS go out' — it counts against committed stock")
}
{
  const r = walkieShortfall({
    pool: 100, orderId: 'A',
    demands: [d('A', 60, '2026-09-16', '2026-09-18', 'committed'), d('B', 60, '2026-09-16', '2026-09-18', 'quoted')],
    subs: [],
  })
  check(r.short === 0 && r.shortIfQuotesLand === 20, "someone else's quote is advisory only: covered, 20 short if it lands")
}
{
  const r = walkieShortfall({
    pool: 100, orderId: 'A',
    demands: [d('A', 60, '2026-09-16', '2026-09-18', 'committed'), d('B', 60, '2026-09-16', '2026-09-18', 'draft')],
    subs: [],
  })
  check(r.short === 0 && r.shortIfQuotesLand === 0, "someone else's draft counts for nothing")
}
{
  const r = walkieShortfall({
    pool: 100, orderId: 'A',
    demands: [d('A', 60, '2026-09-16', '2026-09-18', 'committed'), d('B', 60, '2026-09-18', '2026-09-20', 'committed')],
    subs: [{ quantity: 20, start: '2026-09-18', end: '2026-09-18' }],
  })
  check(r.short === 0 && r.subbedAtPeak === 20, 'recording the sub-rental clears it')
}
{
  const r = walkieShortfall({
    pool: 100, orderId: 'A',
    demands: [d('A', 60, '2026-09-16', '2026-09-18', 'committed'), d('B', 60, '2026-09-18', '2026-09-20', 'committed')],
    subs: [{ quantity: 20, start: '2026-09-21', end: '2026-09-22' }],
  })
  check(r.short === 20, 'a sub on the wrong days covers nothing')
}
{
  const r = walkieShortfall({ pool: 100, orderId: 'Z', demands: [d('A', 60, '2026-09-16', '2026-09-18', 'committed')], subs: [] })
  check(r.short === 0 && r.peakDay === null, 'an order with no walkies has no answer')
}

if (failures.length) {
  console.error(`\n${failures.length} FAILED:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\nall walkie checks passed')
