/**
 * addedAfterPull — gear put on an order the warehouse has already pulled.
 *
 * The failure it guards is the one Wes reported on 2026-09-18: items added
 * mid-job showed up on the check-out screen as already staged and ready,
 * because a line with no row on the filed sheet was pre-filled exactly like
 * a line somebody had counted.
 */

import assert from 'node:assert'
import { addedAfterPull } from '../../src/lib/orders/addedAfterPull'
import { isPickableLine } from '../../src/lib/orders/lineType'

let pass = 0
function check(name: string, fn: () => void) {
  fn()
  pass++
  console.log(`  ✓ ${name}`)
}

const filedAt = new Date('2026-09-16T15:00:00Z')
const line = (id: string) => ({ id, description: id, type: 'EQUIPMENT', warehouseAddedAt: null })

console.log('\naddedAfterPull')

check('no sheet on file → nothing was added after the pull', () => {
  assert.deepStrictEqual(addedAfterPull([line('a'), line('b')], null), [])
})

check('every line spoken for → nothing outstanding', () => {
  const out = addedAfterPull([line('a'), line('b')], {
    submittedAt: filedAt,
    lineIds: ['a', 'b'],
  })
  assert.deepStrictEqual(out, [])
})

check('a line the sheet never mentions is the added one', () => {
  const out = addedAfterPull([line('a'), line('b'), line('c')], {
    submittedAt: filedAt,
    lineIds: ['a', 'b'],
  })
  assert.deepStrictEqual(out.map((l) => l.id), ['c'])
})

check('a line an earlier pass HELD BACK is not "added" — it has a row', () => {
  // The partial sheet files every line, the held-back ones with
  // onSheet:false. Both mechanisms must not claim the same line, or the
  // form would show it struck through AND uncounted.
  const out = addedAfterPull([line('a'), line('held')], {
    submittedAt: filedAt,
    lineIds: ['a', 'held'],
  })
  assert.deepStrictEqual(out, [])
})

check('write-in rows (null line id) never mask a real line', () => {
  const out = addedAfterPull([line('a'), line('b')], {
    submittedAt: filedAt,
    lineIds: [null, 'a', null],
  })
  assert.deepStrictEqual(out.map((l) => l.id), ['b'])
})

check('order is preserved — the sheet prints in line order', () => {
  const out = addedAfterPull([line('a'), line('b'), line('c'), line('d')], {
    submittedAt: filedAt,
    lineIds: ['b'],
  })
  assert.deepStrictEqual(out.map((l) => l.id), ['a', 'c', 'd'])
})

check('the floor\'s own check-out add-on is already on the truck', () => {
  // Straps and pads the driver asked for at handover land after the
  // sheet is filed too — and sending the warehouse back out for gear
  // they loaded themselves is its own miss (checkoutAddOns.ts).
  const strap = { id: 'straps', description: 'Straps, Ratchet', type: 'EQUIPMENT', warehouseAddedAt: new Date('2026-09-16T17:00:00Z') }
  const out = addedAfterPull([line('a'), strap, line('rep-add')], {
    submittedAt: filedAt,
    lineIds: ['a'],
  })
  assert.deepStrictEqual(out.map((l) => l.id), ['rep-add'])
})

console.log('\npickable filter')

check('fees, discounts and labor are not gear to pull', () => {
  assert.strictEqual(isPickableLine({ type: 'FEE' }), false)
  assert.strictEqual(isPickableLine({ type: 'DISCOUNT' }), false)
  assert.strictEqual(isPickableLine({ type: 'LABOR' }), false)
  assert.strictEqual(isPickableLine({ type: 'EQUIPMENT' }), true)
  assert.strictEqual(isPickableLine({ type: 'EXPENDABLE' }), true)
  assert.strictEqual(isPickableLine({ type: 'VEHICLE' }), true)
})

console.log(`\n${pass} checks passed\n`)
