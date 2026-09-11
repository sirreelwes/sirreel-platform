/**
 * Replacement value derivation — the figure a client's broker insures to.
 *
 *   npx tsx tests/coi/replacement-value.test.ts
 *   npm run test:replacement-value
 *
 * Pure + offline. The cases that matter are the two ways the number can lie:
 * counting something that is not rented equipment (a fee, a discount, a box
 * of gaff tape) and presenting a floor as if it were the total. And the
 * source ladder — a reserved unit's fleet value beats the catalog row, the
 * catalog row beats the RentalWorks register, and a class with no unit bound
 * falls back to the dearest unit in the fleet.
 */

import {
  deriveReplacementValue,
  replacementValueSentence,
  toClientReplacementValue,
  type ReplacementLineInput,
} from '../../src/lib/coi/replacementValue'

const failures: string[] = []
function check(cond: boolean, why: string, got?: unknown): void {
  if (cond) console.log(`  ok — ${why}`)
  else {
    console.log(`  FAIL — ${why}${got !== undefined ? ` (got ${JSON.stringify(got)})` : ''}`)
    failures.push(why)
  }
}

type ItemInput = NonNullable<ReplacementLineInput['inventoryItem']>
const item = (id: string, replacementCost: number | null, extra: Partial<ItemInput> = {}): ItemInput => ({
  id,
  replacementCost,
  ...extra,
});

// ── What counts ──────────────────────────────────────────────────────────────
{
  const s = deriveReplacementValue([
    { id: 'l1', type: 'EQUIPMENT', description: 'CP200 Radio', quantity: 10, inventoryItem: item('radio', 350) },
    { id: 'l2', type: 'FEE', description: 'Delivery', quantity: 1 },
    { id: 'l3', type: 'DISCOUNT', description: 'Repeat client', quantity: 1 },
    { id: 'l4', type: 'LABOR', description: 'Driver', quantity: 1 },
    { id: 'l5', type: 'EXPENDABLE', description: 'Gaff tape', quantity: 12, inventoryItem: item('gaff', 20) },
  ])
  check(s.total === 3500, 'radios × quantity, nothing else', s.total)
  check(s.counted === 1, 'fees, discounts, labor and expendables are not rented equipment', s.counted)
  check(s.complete, 'a fully priced order is complete')
}

// ── Kit pieces ride along ───────────────────────────────────────────────────
{
  const s = deriveReplacementValue([
    { id: 'l1', type: 'EQUIPMENT', description: 'CP200 Radio', quantity: 10, inventoryItem: item('radio', 350) },
    { id: 'l2', type: 'EQUIPMENT', description: 'Spare battery', quantity: 20, parentLineItemId: 'l1', inventoryItem: item('batt', 45) },
  ])
  check(s.total === 3500 + 900, 'an included accessory is still the client’s to bring back', s.total)
}

// ── The source ladder ───────────────────────────────────────────────────────
{
  const s = deriveReplacementValue([
    { id: 'l1', type: 'EQUIPMENT', description: 'Starlink Mini', quantity: 1, inventoryItem: item('sl', null, { registerCost: 599 }) },
  ])
  check(s.valued[0]?.source === 'register' && s.total === 599, 'RentalWorks register fills in for an unpriced catalog row', s.valued[0])
}
{
  const s = deriveReplacementValue([
    { id: 'l1', type: 'EQUIPMENT', description: 'Starlink Mini', quantity: 1, inventoryItem: item('sl', 650, { registerCost: 599 }) },
  ])
  check(s.valued[0]?.source === 'catalog' && s.total === 650, 'the catalog row beats the register', s.valued[0])
}
{
  const s = deriveReplacementValue(
    [
      { id: 'l1', orderId: 'o1', type: 'VEHICLE', description: 'Cube Truck', quantity: 1, assetCategoryId: 'cube', inventoryItem: item('cube-row', 60000) },
    ],
    {
      assignments: [
        { orderId: 'o1', status: 'ASSIGNED', asset: { id: 'cube-12', categoryId: 'cube', currentValue: 82000 } },
      ],
    },
  )
  check(s.valued[0]?.source === 'unit' && s.total === 82000, 'the reserved unit’s fleet value beats the catalog row', s.valued[0])
}
{
  const s = deriveReplacementValue(
    [{ id: 'l1', orderId: 'o1', type: 'VEHICLE', description: 'Cube Truck', quantity: 1, assetCategoryId: 'cube' }],
    {
      fleetAssets: [
        { categoryId: 'cube', currentValue: 70000 },
        { categoryId: 'cube', purchasePrice: 95000 },
        { categoryId: 'van', currentValue: 40000 },
      ],
    },
  )
  check(s.valued[0]?.source === 'fleet' && s.total === 95000, 'no unit bound: the dearest active unit in the class', s.valued[0])
}
{
  // Two vehicle lines, one reserved unit — the second line must not reuse it.
  const s = deriveReplacementValue(
    [
      { id: 'l1', orderId: 'o1', type: 'VEHICLE', description: 'Cube Truck', quantity: 1, assetCategoryId: 'cube' },
      { id: 'l2', orderId: 'o1', type: 'VEHICLE', description: 'Cube Truck', quantity: 1, assetCategoryId: 'cube' },
    ],
    { assignments: [{ orderId: 'o1', status: 'ASSIGNED', asset: { id: 'cube-12', categoryId: 'cube', currentValue: 82000 } }] },
  )
  check(s.valued.length === 1 && s.missing.length === 1, 'a reserved unit prices one line, not every line in its class', {
    valued: s.valued.length,
    missing: s.missing.length,
  })
}
{
  const s = deriveReplacementValue(
    [{ id: 'l1', orderId: 'o1', type: 'VEHICLE', description: 'Cube Truck', quantity: 1, assetCategoryId: 'cube' }],
    { assignments: [{ orderId: 'o1', status: 'SWAPPED', asset: { id: 'cube-12', categoryId: 'cube', currentValue: 82000 } }] },
  )
  check(s.missing.length === 1, 'a swapped-off unit no longer prices the line', s)
}
{
  const s = deriveReplacementValue(
    [{ id: 'l1', orderId: 'o1', type: 'VEHICLE', description: 'Cube Truck', quantity: 1, assetCategoryId: 'cube' }],
    { assignments: [{ orderId: 'o1', status: 'ASSIGNED', asset: { id: 'cube-12', categoryId: 'cube', currentValue: 0 } }] },
  )
  check(s.missing.length === 1 && s.missing[0].source === null, 'a $0 fleet value is no value at all', s)
}

// ── A floor is not a total ──────────────────────────────────────────────────
{
  const s = deriveReplacementValue([
    { id: 'l1', type: 'EQUIPMENT', description: 'CP200 Radio', quantity: 10, inventoryItem: item('radio', 350) },
    { id: 'l2', type: 'EQUIPMENT', description: 'Some free-typed thing', quantity: 2 },
    { id: 'l3', type: 'VEHICLE', description: 'Partner motorhome', quantity: 1, subRentals: [{ id: 'sr1' }] },
  ])
  check(!s.complete && s.total === 3500, 'two unpriced lines: the figure is a floor and says so', s)
  check(s.missing.find((m) => m.lineId === 'l3')?.partner === true, 'a partner line is flagged as the partner’s to value')
  check(s.missing.find((m) => m.lineId === 'l2')?.inventoryItemId === null, 'a free-typed line has no catalog row to price')

  const client = toClientReplacementValue(s)!
  check(client.pendingCount === 2 && client.schedule.length === 3, 'the client shape carries the count and the schedule', client)
  check(!('inventoryItemId' in client.schedule[0]) && !('partner' in client.schedule[0]), 'no catalog ids or partner flags cross to the client')
  const sentence = replacementValueSentence(client)!
  check(sentence.includes('at least $3,500') && sentence.includes('2 items still being valued'), 'the sentence names the floor and the gap', sentence)
}
{
  const s = deriveReplacementValue([
    { id: 'l1', type: 'EQUIPMENT', description: 'CP200 Radio', quantity: 10, inventoryItem: item('radio', 350) },
  ])
  const sentence = replacementValueSentence(toClientReplacementValue(s))!
  check(sentence === 'Replacement value of the rented equipment on this order: $3,500.', 'a complete figure is stated flat', sentence)
}
{
  check(toClientReplacementValue(deriveReplacementValue([{ id: 'f', type: 'FEE', description: 'Delivery', quantity: 1 }])) === null, 'an order with nothing rented has no figure to show')
  check(
    replacementValueSentence(toClientReplacementValue(deriveReplacementValue([{ id: 'x', type: 'EQUIPMENT', description: 'Thing', quantity: 1 }])))!.includes('being confirmed'),
    'nothing priced yet reads as being confirmed, never as $0',
  )
}

if (failures.length) {
  console.error(`\n${failures.length} failing`)
  process.exit(1)
}
console.log('\nall passed')
