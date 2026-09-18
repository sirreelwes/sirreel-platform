/**
 * Stock rows that fill another row's orders.
 *
 * The trap this exists for: `WALKIE_FAMILY_CODES` used to be
 * `[WALKIE_ORDER_CODE, ...STOCK_ONLY_CODES]`, which was right while
 * walkies were the only stock-fill in the system and became a counting
 * bug the moment they were not — walkiePool sums qtyOwned across the
 * family, so the 25 MiFis would have been counted as radios.
 */

import assert from 'node:assert'
import {
  STOCK_FILLS, STOCK_ONLY_CODES, isStockOnlyCode, orderCodeForStockCode,
  stockCodesFor, familyCodes, NOT_STOCK_ONLY_WHERE,
} from '../../src/lib/catalog/stockFills'
import { WALKIE_ORDER_CODE, WALKIE_FAMILY_CODES, isWalkieFamilyCode } from '../../src/lib/catalog/walkies'

let pass = 0
const check = (name: string, fn: () => void) => { fn(); pass++; console.log(`  ✓ ${name}`) }

console.log('\nstock fills')

check('a walkie family is radios only — never the MiFis', () => {
  assert.deepStrictEqual([...WALKIE_FAMILY_CODES].sort(), ['103733', '104387'])
  assert.strictEqual(isWalkieFamilyCode('105020'), false)
  assert.strictEqual(isWalkieFamilyCode('104402'), false)
  assert.strictEqual(isWalkieFamilyCode('103733'), true)
})

check('both carriers fill the one orderable MiFi', () => {
  assert.strictEqual(orderCodeForStockCode('105020'), 'COM-MOBILE-INTERNET-MIFI')
  assert.strictEqual(orderCodeForStockCode('104402'), 'COM-MOBILE-INTERNET-MIFI')
  assert.deepStrictEqual(stockCodesFor('COM-MOBILE-INTERNET-MIFI').sort(), ['104402', '105020'])
  assert.deepStrictEqual(
    familyCodes('COM-MOBILE-INTERNET-MIFI').sort(),
    ['104402', '105020', 'COM-MOBILE-INTERNET-MIFI'],
  )
})

check('an ordinary row fills nothing and is filled by nothing', () => {
  assert.strictEqual(orderCodeForStockCode('104457'), null)
  assert.deepStrictEqual(stockCodesFor('104457'), [])
  assert.deepStrictEqual(familyCodes('104457'), ['104457'])
  assert.strictEqual(isStockOnlyCode('104457'), false)
})

check('null and undefined are answers, not crashes', () => {
  assert.strictEqual(isStockOnlyCode(null), false)
  assert.strictEqual(orderCodeForStockCode(undefined), null)
  assert.deepStrictEqual(stockCodesFor(null), [])
  assert.deepStrictEqual(familyCodes(undefined), [])
})

check('every stock row is hidden from ordering and client surfaces', () => {
  const hidden = [...NOT_STOCK_ONLY_WHERE.NOT.code.in]
  for (const f of STOCK_FILLS) assert.ok(hidden.includes(f.stock), `${f.stock} not hidden`)
  assert.deepStrictEqual([...STOCK_ONLY_CODES].sort(), hidden.sort())
})

check('no row is both stock and order — that would be a cycle', () => {
  const orders = new Set(STOCK_FILLS.map((f) => f.order))
  for (const f of STOCK_FILLS) {
    assert.ok(!orders.has(f.stock), `${f.stock} is stock AND an order row`)
    assert.notStrictEqual(f.stock, f.order)
  }
  assert.ok(!STOCK_ONLY_CODES.includes(WALKIE_ORDER_CODE))
})

check('every entry says what it is, for whoever reads it next', () => {
  for (const f of STOCK_FILLS) assert.ok(f.what.trim().length > 10, `${f.stock} has no explanation`)
})

console.log(`\n${pass} checks passed\n`)
