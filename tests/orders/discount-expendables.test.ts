/**
 * Expendables are never discounted.
 *
 *   npx tsx tests/orders/discount-expendables.test.ts
 *   npm run test:discount-expendables
 *
 * Pure + offline — computeOrderTotals takes lines/discounts/taxRate and
 * returns numbers.
 *
 * Wes's rule (2026-08-29): expendables are a SALE, not a rental. They're
 * consumables bought in for the job and passed through at cost — there's
 * no day-rate margin in them to give back. An order-wide "30% off" that
 * quietly took 30% off the trash liners was discounting the one category
 * that can't absorb it.
 *
 * The dangerous failure direction is silent: nobody reads a subtotal and
 * notices that $15 of liners got $4.50 shaved off it. So the rule is
 * pinned here at the math layer, which every renderer shares — quote PDF,
 * invoice generator, the persisted Order row, and the order detail API.
 */

import { computeOrderTotals } from '../../src/lib/orders/discountedTotals'
import type { LineForTotals, DiscountForTotals } from '../../src/lib/orders/discountedTotals'

const failures: string[] = []

function eq(got: unknown, want: unknown, why: string): void {
  if (got === want) {
    console.log(`  ok — ${why}`)
  } else {
    failures.push(`${why}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
  }
}

const gear = (department: LineForTotals['department'], lineTotal: number): LineForTotals =>
  ({ department, type: 'EQUIPMENT', lineTotal })

// $100 of rentable gear + $15 of consumables.
const LINES: LineForTotals[] = [
  gear('PRO_SUPPLIES', 100),
  { department: 'EXPENDABLES', type: 'EXPENDABLE', lineTotal: 15 },
]

const orderPct = (value: number): DiscountForTotals[] =>
  [{ scope: 'ORDER', departmentKey: null, type: 'PERCENT', value, label: 'Order discount' }]

// ── ORDER scope carves expendables out of the base ───────────────────
console.log('An order-wide discount cannot reach expendables\n')

const pct = computeOrderTotals({ lines: LINES, discounts: orderPct(30), taxRate: 0 })
eq(pct.rawSubtotal, 115, 'raw subtotal still counts the expendables')
eq(pct.expendablesSubtotal, 15, 'expendables carved out and reported')
eq(pct.discountableSubtotal, 100, 'discountable base is the gear alone')
// The bug this exists to prevent: 30% of 115 = 34.50, which shaves 4.50
// off consumables that are sold at cost.
eq(pct.orderDiscount, 30, '30% takes 30 (of the gear), not 34.50 (of everything)')
eq(pct.total, 85, 'total = 100 gear - 30 discount + 15 expendables at full price')

// ── FIXED clamps to the discountable base, not the whole subtotal ────
console.log('\nA fixed discount stops at the gear\n')

const fixed = computeOrderTotals({
  lines: LINES,
  discounts: [{ scope: 'ORDER', departmentKey: null, type: 'FIXED', value: 500, label: 'Comp' }],
  taxRate: 0,
})
eq(fixed.orderDiscount, 100, 'an oversized fixed discount clamps at the gear, not 115')
eq(fixed.total, 15, 'the expendables spend is the floor — it survives a full comp')

// ── FLAT_TOTAL cannot be driven below the consumables ────────────────
console.log('\nA flat target total cannot go below what the consumables cost\n')

const flat = computeOrderTotals({
  lines: LINES,
  discounts: [{ scope: 'ORDER', departmentKey: null, type: 'FLAT_TOTAL', value: 0, label: 'Free' }],
  taxRate: 0,
})
eq(flat.orderDiscount, 100, 'discount clamps at the gear')
eq(flat.total, 15, '"make it free" still bills the consumables')

// ── DEPARTMENT scope is refused at the math layer too ────────────────
console.log('\nA department discount aimed at expendables does nothing\n')

const deptOnExp = computeOrderTotals({
  lines: LINES,
  discounts: [{ scope: 'DEPARTMENT', departmentKey: 'EXPENDABLES', type: 'PERCENT', value: 50, label: 'nope' }],
  taxRate: 0,
})
const expRow = deptOnExp.byDepartment.find((d) => d.department === 'EXPENDABLES')
eq(expRow?.discount, 0, 'a pre-existing EXPENDABLES row is zeroed, not honoured')
eq(deptOnExp.total, 115, 'nothing comes off the total')

// ── Departments that ARE discountable keep working ───────────────────
console.log('\nEvery other department still discounts normally\n')

const deptOk = computeOrderTotals({
  lines: LINES,
  discounts: [{ scope: 'DEPARTMENT', departmentKey: 'PRO_SUPPLIES', type: 'PERCENT', value: 30, label: 'Pro' }],
  taxRate: 0,
})
eq(deptOk.byDepartment.find((d) => d.department === 'PRO_SUPPLIES')?.discount, 30, 'Pro Supplies takes its 30%')
eq(deptOk.total, 85, 'gear discounted, consumables untouched')

// ── No expendables at all = the old math, untouched ──────────────────
console.log('\nAn order with no expendables is unaffected\n')

const noExp = computeOrderTotals({ lines: [gear('VEHICLES', 200)], discounts: orderPct(10), taxRate: 0 })
eq(noExp.discountableSubtotal, 200, 'discountable base equals the subtotal')
eq(noExp.orderDiscount, 20, '10% of 200')
eq(noExp.total, 180, 'unchanged from the pre-rule math')

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All expendables-discount checks passed.')
