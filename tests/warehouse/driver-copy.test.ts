/**
 * The driver's copy — which lines print, and with what count, once the
 * check-out sheet is filed (Wes 2026-09-12: "it's the driver's receipt").
 *
 *   npx tsx tests/warehouse/driver-copy.test.ts
 *   npm run test:driver-copy
 *
 * Pure + offline: renderPickListPdf loads the order and the filed OUT
 * report and hands both to applyFiledSheet; these are the rules it
 * draws from. Both failure directions matter: print a line that stayed
 * on the shelf and the driver signs for gear still in the building;
 * blank a line that was counted and the receipt says nothing about the
 * thing the client is billed for.
 */

import assert from 'node:assert'
import { applyFiledSheet } from '../../src/lib/warehouse/driverCopy'

let pass = 0
function check(name: string, fn: () => void) {
  fn()
  pass++
  console.log(`  ✓ ${name}`)
}

const lines = [
  { id: 'radio', description: 'CP200 Radio', quantity: 15 },
  { id: 'battery', description: 'CP200 Battery', quantity: 23 },
  { id: 'hazer', description: 'Hazer', quantity: 1 },
  { id: 'fan', description: 'Fan', quantity: 2 },
]

check('a filed count prints in the Picked box, zero included', () => {
  const r = applyFiledSheet(lines, [
    { orderLineItemId: 'radio', actualQty: 15, onSheet: true },
    { orderLineItemId: 'battery', actualQty: 20, onSheet: true },
    { orderLineItemId: 'hazer', actualQty: 0, onSheet: true },
    { orderLineItemId: 'fan', actualQty: 2, onSheet: true },
  ])
  assert.equal(r.omittedLineCount, 0)
  assert.deepEqual(
    r.onSheet.map((x) => [x.line.id, x.pickedQty]),
    [['radio', 15], ['battery', 20], ['hazer', 0], ['fan', 2]],
  )
})

check('a line the partial pull left on the shelf is OFF the copy and counted as omitted', () => {
  const r = applyFiledSheet(lines, [
    { orderLineItemId: 'radio', actualQty: 15, onSheet: true },
    { orderLineItemId: 'battery', actualQty: 23, onSheet: true },
    { orderLineItemId: 'hazer', actualQty: 1, onSheet: false },
    { orderLineItemId: 'fan', actualQty: 2, onSheet: false },
  ])
  assert.equal(r.omittedLineCount, 2)
  assert.deepEqual(r.onSheet.map((x) => x.line.id), ['radio', 'battery'])
})

check('a line nobody counted (added after the sheet) prints a BLANK box, not its ordered quantity', () => {
  const r = applyFiledSheet(lines, [
    { orderLineItemId: 'radio', actualQty: 15, onSheet: true },
    { orderLineItemId: 'battery', actualQty: 23, onSheet: true },
    { orderLineItemId: 'hazer', actualQty: 1, onSheet: true },
  ])
  const fan = r.onSheet.find((x) => x.line.id === 'fan')
  assert.ok(fan, 'the uncounted line is still on the copy')
  assert.equal(fan!.pickedQty, null)
})

check('a report row with no line (a check-in addition, or a legacy one) is ignored', () => {
  const r = applyFiledSheet(lines, [
    { orderLineItemId: null, actualQty: 4, onSheet: true },
    { orderLineItemId: 'radio', actualQty: 15, onSheet: true },
  ])
  assert.equal(r.onSheet.length, 4)
  assert.equal(r.onSheet[0].pickedQty, 15)
})

check('order of the lines is the order of the sheet, not of the report', () => {
  const r = applyFiledSheet(lines, [
    { orderLineItemId: 'fan', actualQty: 2, onSheet: true },
    { orderLineItemId: 'radio', actualQty: 15, onSheet: true },
  ])
  assert.deepEqual(r.onSheet.map((x) => x.line.id), ['radio', 'battery', 'hazer', 'fan'])
})

console.log(`\nall checks passed (${pass})`)
