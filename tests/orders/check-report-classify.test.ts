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
import { classifyCheckLine } from '../../src/lib/orders/checkReports'

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

console.log(`\nall checks passed (${pass})`)
