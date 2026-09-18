/**
 * Does this order honour the client's standing deals?
 *
 *   npx tsx tests/orders/standing-deal-check.test.ts
 *   npm run test:standing-deal-check
 *
 * Pure + offline. The cases that matter are the two silent ones: a
 * department deal that never seeded (the order predates the deal, or the
 * production company was corrected afterwards) and an item deal a line is
 * billing above — neither leaves a mark anywhere else on the order.
 *
 * The other half of the job is NOT crying wolf. A panel that flags a
 * supplies deal on a vehicles-only order is a panel reps learn to scroll
 * past, and then the real miss goes unread too.
 */

import { reconcileStandingDeals, needsAttention } from '../../src/lib/orders/standingDealCheck'
import type {
  StandingDealInput,
  OrderDiscountInput,
  OrderLineInput,
} from '../../src/lib/orders/standingDealCheck'

const failures: string[] = []

const SUPPLIES: StandingDealInput = {
  id: 'd1', label: 'Production supply orders', percentOff: 50,
  departmentKey: 'PRO_SUPPLIES', inventoryItemIds: [],
}
const CUBES: StandingDealInput = {
  id: 'd2', label: 'Cube trucks & cargo vans', percentOff: 20,
  departmentKey: null, inventoryItemIds: ['item-cube', 'item-cargo'],
}

const line = (o: Partial<OrderLineInput>): OrderLineInput => ({
  id: 'l1', description: 'Line', inventoryItemId: null,
  department: 'PRO_SUPPLIES', rate: 100, resolvedRate: 100, ...o,
})

function check(
  why: string,
  input: { deals: StandingDealInput[]; discounts: OrderDiscountInput[]; lines: OrderLineInput[] },
  want: { verdict: string; attention: boolean; lines?: number },
): void {
  const [got] = reconcileStandingDeals(input)
  const wantLines = want.lines ?? 0
  if (got.verdict === want.verdict && needsAttention(got) === want.attention && got.lines.length === wantLines) {
    console.log(`  ok — ${why}`)
  } else {
    failures.push(
      `${why}: got ${got.verdict} attention=${needsAttention(got)} lines=${got.lines.length}, ` +
      `wanted ${want.verdict} attention=${want.attention} lines=${wantLines}`,
    )
  }
}

console.log('Department deals — seeded as a discount row at order create\n')

check(
  'the deal is on the order at the agreed percent',
  {
    deals: [SUPPLIES],
    discounts: [{ scope: 'DEPARTMENT', departmentKey: 'PRO_SUPPLIES', type: 'PERCENT', value: 50, label: 'Production supply orders' }],
    lines: [line({})],
  },
  { verdict: 'applied', attention: false },
)

// The case the reminder exists for: the order was created before the deal
// was entered, or its production company was corrected afterwards.
check(
  'the order quotes that department and carries NO row',
  { deals: [SUPPLIES], discounts: [], lines: [line({})] },
  { verdict: 'missing', attention: true },
)

// Not crying wolf: a supplies deal on a vehicles-only order is not a miss.
check(
  'nothing quoted in that department is NOT a miss',
  { deals: [SUPPLIES], discounts: [], lines: [line({ department: 'VEHICLES' })] },
  { verdict: 'not-quoted', attention: false },
)

check(
  'a row at a different percent reads as differs, not applied',
  {
    deals: [SUPPLIES],
    discounts: [{ scope: 'DEPARTMENT', departmentKey: 'PRO_SUPPLIES', type: 'PERCENT', value: 30, label: 'Courtesy' }],
    lines: [line({})],
  },
  { verdict: 'differs', attention: true },
)

// A dollars-off row is not the percentage they negotiated, whatever it
// nets out to on today's subtotal — the deal is a rate, the row is a sum.
check(
  'a FIXED row in that department is not the deal',
  {
    deals: [SUPPLIES],
    discounts: [{ scope: 'DEPARTMENT', departmentKey: 'PRO_SUPPLIES', type: 'FIXED', value: 50, label: 'Goodwill' }],
    lines: [line({})],
  },
  { verdict: 'differs', attention: true },
)

// An ORDER-scope discount is a different thing entirely and must not be
// mistaken for the department's row.
check(
  'an order-wide discount does not satisfy a department deal',
  {
    deals: [SUPPLIES],
    discounts: [{ scope: 'ORDER', departmentKey: null, type: 'PERCENT', value: 50, label: 'Order discount' }],
    lines: [line({})],
  },
  { verdict: 'missing', attention: true },
)

console.log('\nItem deals — priced into the line, so there is no row to find\n')

check(
  'covered lines bill at their price',
  {
    deals: [CUBES],
    discounts: [],
    lines: [line({ inventoryItemId: 'item-cube', department: 'VEHICLES', rate: 136, resolvedRate: 136 })],
  },
  { verdict: 'priced-in', attention: false },
)

// The failure the picker fix closed going forward — this is how an order
// already built shows it.
check(
  'a covered line billing ABOVE their price is named',
  {
    deals: [CUBES],
    discounts: [],
    lines: [
      line({ id: 'l-cube', inventoryItemId: 'item-cube', department: 'VEHICLES', rate: 170, resolvedRate: 136 }),
      line({ id: 'l-other', inventoryItemId: 'item-other', department: 'VEHICLES', rate: 200, resolvedRate: 150 }),
    ],
  },
  { verdict: 'over-billed', attention: true, lines: 1 },
)

// Billing BELOW the deal is a rep giving more away, which is their call —
// the panel is not a price police.
check(
  'a covered line billing below their price is left alone',
  {
    deals: [CUBES],
    discounts: [],
    lines: [line({ inventoryItemId: 'item-cube', department: 'VEHICLES', rate: 120, resolvedRate: 136 })],
  },
  { verdict: 'priced-in', attention: false },
)

check(
  'none of the covered items are on this order',
  { deals: [CUBES], discounts: [], lines: [line({ inventoryItemId: 'item-other' })] },
  { verdict: 'not-quoted', attention: false },
)

// An unresolved line is a question, not an accusation — saying "billing
// above" with nothing to compare against would be inventing the charge.
check(
  'covered lines with no resolved rate read as unchecked, not over-billed',
  {
    deals: [CUBES],
    discounts: [],
    lines: [line({ inventoryItemId: 'item-cube', department: 'VEHICLES', rate: 170, resolvedRate: null })],
  },
  { verdict: 'unchecked', attention: false },
)

// Sub-cent float noise must not read as an overcharge: 20% off $127.55 is
// $102.04, and the line stored 102.04.
check(
  'a cent-exact match is not an overcharge',
  {
    deals: [CUBES],
    discounts: [],
    lines: [line({ inventoryItemId: 'item-cube', department: 'VEHICLES', rate: 102.04, resolvedRate: 102.04 })],
  },
  { verdict: 'priced-in', attention: false },
)

console.log('\nOrder of reports follows the deals passed in')
{
  const got = reconcileStandingDeals({ deals: [SUPPLIES, CUBES], discounts: [], lines: [line({})] })
  if (got.length === 2 && got[0].dealId === 'd1' && got[1].dealId === 'd2') {
    console.log('  ok — one report per deal, in order')
  } else {
    failures.push(`report order: got ${got.map((r) => r.dealId).join(',')}`)
  }
}

console.log('')
if (failures.length) {
  console.error(`FAILED (${failures.length}):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All standing-deal-check cases passed.')
