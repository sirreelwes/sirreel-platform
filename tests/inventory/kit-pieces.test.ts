/**
 * Included-accessory ratio tests — the arithmetic that decides how many
 * charging banks and spare batteries leave with a walkie order.
 *
 *   npx tsx tests/inventory/kit-pieces.test.ts
 *   npm run test:kit-pieces
 *
 * Pure math, no DB. The cases are the ones the hardcoded walkie kit was
 * written around (Wes's ratios, 2026-08-17): the ratios themselves now
 * live in InventoryKitPiece rows, but the ROUNDING rules they depend on
 * are code, and silently flipping one sends a crew out short.
 */

import { resolveKitQuantity, describeKitRatio, type KitRatio } from '../../src/lib/inventory/kitMath'

const failures: string[] = []

function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message)
  else console.log(`  ok — ${message}`)
}

function eq(actual: number, expected: number, message: string): void {
  check(actual === expected, `${message} (got ${actual}, want ${expected})`)
}

// Spare batteries: 50% of the radio count, rounded UP.
const BATTERIES: KitRatio = { qtyPer: 0.5, perUnits: 1, rounding: 'CEIL', minQty: 0 }
// Charging banks: one per 12 radios, rounded DOWN, but never zero.
const BANKS: KitRatio = { qtyPer: 1, perUnits: 12, rounding: 'FLOOR', minQty: 1 }

console.log('\nSpare batteries — 0.5 per radio, round up')
eq(resolveKitQuantity(BATTERIES, 10), 5, '10 radios → 5 spares')
eq(resolveKitQuantity(BATTERIES, 15), 8, '15 radios → 8 spares, not 7 — a fraction rounds up')
eq(resolveKitQuantity(BATTERIES, 1), 1, 'one radio still gets a spare')

console.log('\nCharging banks — 1 per 12, round down, min 1')
eq(resolveKitQuantity(BANKS, 24), 2, '24 radios → 2 banks')
eq(resolveKitQuantity(BANKS, 23), 1, '23 radios → 1 bank — the fraction does NOT round up')
eq(resolveKitQuantity(BANKS, 5), 1, 'under a full bank still ships one — floor() alone would send none')

console.log('\nZero and nonsense')
eq(resolveKitQuantity(BANKS, 0), 0, 'nobody rented the radio → nothing ships, minQty notwithstanding')
eq(resolveKitQuantity(BATTERIES, -3), 0, 'a negative quantity ships nothing')
eq(resolveKitQuantity({ ...BANKS, perUnits: 0 }, 4), 4, 'perUnits 0 falls back to per-1 rather than dividing by zero')
eq(resolveKitQuantity(BATTERIES, 2.9), 1, 'a fractional parent quantity floors before the ratio')

console.log('\nRatio description')
check(
  describeKitRatio(BANKS) === '1 per 12, rounded down, min 1',
  `bank ratio reads as a sentence (got "${describeKitRatio(BANKS)}")`,
)
check(
  describeKitRatio(BATTERIES) === '0.5 per 1, rounded up',
  `battery ratio reads as a sentence (got "${describeKitRatio(BATTERIES)}")`,
)

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\nAll kit-piece ratio checks passed.\n')
