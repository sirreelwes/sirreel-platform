/**
 * Gear that is ours, barcoded, and never rented.
 *
 * The failure this prevents is a report that cries wolf: eight truck jump
 * starters reported as "unmatched — go and match them" every morning for
 * ever, until the morning a code that really is missing scrolls past with
 * them.
 */

import assert from 'node:assert'
import {
  NON_RENTAL_STOCK, isNonRentalRwCode, nonRentalStockFor,
} from '../../src/lib/catalog/nonRentalStock'
import { STOCK_ONLY_CODES } from '../../src/lib/catalog/stockFills'

let pass = 0
const check = (name: string, fn: () => void) => { fn(); pass++; console.log(`  ✓ ${name}`) }

console.log('\nnon-rental stock')

check('the truck jump starters are on the list', () => {
  assert.strictEqual(isNonRentalRwCode('105159'), true)
  assert.match(nonRentalStockFor('105159')!.what, /jump starter/i)
})

check('ordinary rental gear is not', () => {
  for (const code of ['104457', '103856', '105020', '104402']) {
    assert.strictEqual(isNonRentalRwCode(code), false, code)
    assert.strictEqual(nonRentalStockFor(code), null, code)
  }
})

check('null and undefined are answers, not crashes', () => {
  assert.strictEqual(isNonRentalRwCode(null), false)
  assert.strictEqual(isNonRentalRwCode(undefined), false)
  assert.strictEqual(nonRentalStockFor(null), null)
})

check('nothing is both non-rental and stock that fills an order', () => {
  // A row cannot both never go on an order and quietly fill someone's.
  for (const r of NON_RENTAL_STOCK) {
    assert.ok(!STOCK_ONLY_CODES.includes(r.icode), `${r.icode} is in both registries`)
  }
})

check('every entry names the gear AND who decided', () => {
  const seen = new Set<string>()
  for (const r of NON_RENTAL_STOCK) {
    assert.ok(r.what.trim().length > 5, `${r.icode} has no description`)
    assert.match(r.ruling, /\d{4}-\d{2}-\d{2}/, `${r.icode} has no dated ruling`)
    assert.ok(!seen.has(r.icode), `${r.icode} listed twice`)
    seen.add(r.icode)
  }
})

console.log(`\n${pass} checks passed\n`)
