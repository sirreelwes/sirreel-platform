/**
 * classifyCheckLine — what a marked-up pull sheet MEANS.
 *
 * This function decides whether the client's order gets rewritten, so
 * the branches are guarded here rather than trusted. The two that matter
 * most and are easiest to get backwards:
 *
 *   - a row with no order line is ADDED even when its counts look
 *     ordinary — it is gear on the truck that was never sold, and it has
 *     to reach the agent to be priced;
 *   - a substitution is a SUBSTITUTE even when the count is unchanged,
 *     because "one of something else" is not "one of what was ordered",
 *     and a quantity-only reading would silently pass a swapped truck
 *     through as if nothing happened.
 */

import assert from 'node:assert'
import { changeMovesOrder, classifyCheckLine, describeCheckChange } from '../../src/lib/orders/checkLineChange'

let pass = 0
function check(name: string, fn: () => void) {
  fn()
  pass++
  console.log(`  ✓ ${name}`)
}

const line = (over: Partial<Parameters<typeof classifyCheckLine>[0]> = {}) => ({
  orderLineItemId: 'li-1',
  description: '5-ton grip truck',
  expectedQty: 2,
  actualQty: 2,
  substituteFor: null,
  note: null,
  ...over,
})

check('everything went as ordered', () => {
  assert.equal(classifyCheckLine(line()), 'NONE')
})

check('fewer than ordered is SHORT', () => {
  assert.equal(classifyCheckLine(line({ actualQty: 1 })), 'SHORT')
})

check('more than ordered is EXTRA', () => {
  assert.equal(classifyCheckLine(line({ actualQty: 3 })), 'EXTRA')
})

check('none of it went is REMOVED, not SHORT', () => {
  // A zero count is a decision ("we did not send this"), not a shortfall.
  // The order line goes to quantity 0 either way, but the agent reads a
  // different sentence.
  assert.equal(classifyCheckLine(line({ actualQty: 0 })), 'REMOVED')
})

check('a swap at the same count is SUBSTITUTE, not NONE', () => {
  assert.equal(
    classifyCheckLine(line({ description: '3-ton grip truck', substituteFor: '5-ton grip truck' })),
    'SUBSTITUTE',
  )
})

check('a swap outranks a count difference', () => {
  // Sending one 3-ton in place of two 5-tons is a substitution the agent
  // has to price, not merely a short count.
  assert.equal(
    classifyCheckLine(line({ actualQty: 1, description: '3-ton', substituteFor: '5-ton' })),
    'SUBSTITUTE',
  )
})

check('whitespace is not a substitution', () => {
  assert.equal(classifyCheckLine(line({ substituteFor: '   ' })), 'NONE')
})

check('a row with no order line is ADDED', () => {
  assert.equal(
    classifyCheckLine({
      orderLineItemId: null,
      description: 'apple box (x6)',
      expectedQty: 0,
      actualQty: 6,
    }),
    'ADDED',
  )
})

check('an added row stays ADDED even when the counts match', () => {
  assert.equal(
    classifyCheckLine({ orderLineItemId: null, description: 'furni pad', expectedQty: 0, actualQty: 0 }),
    'ADDED',
  )
})

// describeCheckChange is the wording the supervisor confirms, the audit
// row stores, the agent reads and the client's corrected quote quotes.
// One function feeds all four; these pin the sentences so a change to
// the confirm screen cannot quietly reword what the client is told.
check('a count change reads as a count change', () => {
  assert.equal(describeCheckChange(line({ actualQty: 1 })), '5-ton grip truck: 2 → 1')
})

check('a swap names what it replaced', () => {
  assert.equal(
    describeCheckChange(line({ description: '3-ton grip truck', substituteFor: '5-ton grip truck' })),
    '5-ton grip truck → 3-ton grip truck (×2)',
  )
})

check('nothing sent says so, rather than "→ 0"', () => {
  assert.equal(describeCheckChange(line({ actualQty: 0 })), 'did not send 5-ton grip truck')
})

check('an unsold row reads as added', () => {
  assert.equal(
    describeCheckChange({
      orderLineItemId: null, description: 'furni pad', expectedQty: 0, actualQty: 4,
    }),
    'added furni pad ×4',
  )
})

// changeMovesOrder — what filing DOES, as opposed to what the sheet SAYS.
// Since 2026-09-12 swaps and additions are written onto the order, so a
// re-opened sheet (which pre-fills the swap it recorded) must not read
// its own applied swap as a fresh change: that would rename a line to
// its own name, re-flag the agent and email the client an identical
// "updated" quote.
const current = { description: '5-ton grip truck', inventoryItemId: 'inv-5ton' }

check('an unchanged line moves nothing', () => {
  assert.equal(changeMovesOrder(line({ current })), false)
})

check('a moved count moves the order', () => {
  assert.equal(changeMovesOrder(line({ actualQty: 1, current })), true)
  assert.equal(changeMovesOrder(line({ actualQty: 0, current })), true)
})

check('a fresh swap moves the order', () => {
  assert.equal(
    changeMovesOrder(line({ description: '3-ton grip truck', substituteFor: '5-ton grip truck', current })),
    true,
  )
})

check('a swap the order already carries does not move it again', () => {
  // The line was renamed on the first filing; re-opening pre-fills the
  // same substituteFor, and the description now EQUALS the order's.
  const applied = { description: '3-ton grip truck', inventoryItemId: 'inv-5ton' }
  assert.equal(
    changeMovesOrder(line({ description: '3-ton grip truck', substituteFor: '5-ton grip truck', current: applied })),
    false,
  )
})

check('a swap that binds a different catalog row moves the order even at the same name', () => {
  const applied = { description: '3-ton grip truck', inventoryItemId: 'inv-5ton' }
  assert.equal(
    changeMovesOrder(line({
      description: '3-ton grip truck', substituteFor: '5-ton grip truck',
      inventoryItemId: 'inv-3ton', current: applied,
    })),
    true,
  )
})

check('a swap with no known current state is assumed to move', () => {
  assert.equal(
    changeMovesOrder(line({ description: '3-ton grip truck', substituteFor: '5-ton grip truck', current: null })),
    true,
  )
})

check('an added row moves the order; an added row at zero does not', () => {
  const added = { orderLineItemId: null, description: 'furni pad', expectedQty: 0, actualQty: 4 }
  assert.equal(changeMovesOrder(added), true)
  assert.equal(changeMovesOrder({ ...added, actualQty: 0 }), false)
})

console.log(`\nall checks passed (${pass})`)
