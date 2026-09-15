/**
 * attributeLines — who counted what on a sheet done in passes.
 *
 * The failure this guards is the one the feature exists to prevent: the
 * second person finishing a sheet re-submits the first person's lines
 * verbatim, and if that reads as a count, every line on the order ends up
 * credited to whoever filed last.
 */

import assert from 'node:assert'
import { attributeLines, summarizePasses, rollupPreppedBy } from '../../src/lib/orders/checkPasses'

let pass = 0
function check(name: string, fn: () => void) {
  fn()
  pass++
  console.log(`  ✓ ${name}`)
}

const t1 = new Date('2026-09-15T17:10:00Z')
const t2 = new Date('2026-09-15T18:40:00Z')
const carlos = { name: 'Carlos', userId: 'u-carlos', at: t1 }
const pedro = { name: 'Pedro', userId: 'u-pedro', at: t2 }

const prior = (over: Partial<Parameters<typeof attributeLines>[0][number]> = {}) => ({
  orderLineItemId: 'walkies',
  description: 'CP200 radio',
  actualQty: 12,
  substituteFor: null,
  note: null,
  onSheet: true,
  countedBy: 'Carlos',
  countedById: 'u-carlos',
  countedAt: t1,
  ...over,
})
const next = (over: Partial<Parameters<typeof attributeLines>[1][number]> = {}) => ({
  orderLineItemId: 'walkies',
  description: 'CP200 radio',
  actualQty: 12,
  substituteFor: null,
  note: null,
  onSheet: true,
  ...over,
})

check('a first filing stamps every counted line with this pass', () => {
  const [a, b] = attributeLines([], [next(), next({ orderLineItemId: 'cable', onSheet: false })], carlos, null)
  assert.deepEqual(a, { countedBy: 'Carlos', countedById: 'u-carlos', countedAt: t1, thisPass: true })
  assert.equal(b.countedBy, null, 'an off-sheet line was counted by nobody')
  assert.equal(b.thisPass, false)
})

check('the second person re-submitting the first person\'s line does not take it', () => {
  const [a] = attributeLines([prior()], [next()], pedro, null)
  assert.equal(a.countedBy, 'Carlos')
  assert.equal(a.countedAt, t1)
  assert.equal(a.thisPass, false)
})

check('the line left for later is the second person\'s when they count it', () => {
  const [, b] = attributeLines(
    [prior(), prior({ orderLineItemId: 'cable', description: 'Stinger', onSheet: false, countedBy: null, countedById: null, countedAt: null, actualQty: 6 })],
    [next(), next({ orderLineItemId: 'cable', description: 'Stinger', actualQty: 6 })],
    pedro, null,
  )
  assert.equal(b.countedBy, 'Pedro')
  assert.equal(b.thisPass, true)
})

check('changing the count, the swap, the note or the name makes it a re-count', () => {
  for (const over of [{ actualQty: 11 }, { substituteFor: 'CP100' }, { note: 'one cracked' }, { description: 'CP200d radio' }]) {
    const [a] = attributeLines([prior()], [next(over)], pedro, null)
    assert.equal(a.countedBy, 'Pedro', JSON.stringify(over))
  }
})

check('whitespace is not a re-count', () => {
  const [a] = attributeLines([prior({ note: 'ok' })], [next({ note: '  ok ' })], pedro, null)
  assert.equal(a.countedBy, 'Carlos')
})

check('a row filed before lines carried a name reads as the old report\'s preppedBy', () => {
  const legacy = { name: 'Albert', userId: 'u-albert', at: t1 }
  const [a] = attributeLines([prior({ countedBy: null, countedById: null, countedAt: null })], [next()], pedro, legacy)
  assert.deepEqual(a, { countedBy: 'Albert', countedById: 'u-albert', countedAt: t1, thisPass: false })
})

check('a legacy row with no name on the old report is this pass\'s', () => {
  const [a] = attributeLines([prior({ countedBy: null, countedById: null, countedAt: null })], [next()], pedro, { name: null, userId: 'x', at: t1 })
  assert.equal(a.countedBy, 'Pedro')
})

check('added rows match by description + count, and each prior row is used once', () => {
  const sand = { orderLineItemId: null, description: 'Sandbag', actualQty: 4 }
  const res = attributeLines([prior(sand)], [next(sand), next(sand)], pedro, null)
  assert.equal(res[0].countedBy, 'Carlos')
  assert.equal(res[1].countedBy, 'Pedro', 'the second identical row is new')
})

check('a line off-sheet last time and on now is never "carried"', () => {
  const [a] = attributeLines([prior({ onSheet: false })], [next()], pedro, null)
  assert.equal(a.countedBy, 'Pedro')
})

check('summary: one entry per name, first counter first, rollup joins them', () => {
  const passes = summarizePasses([
    { onSheet: true, countedBy: 'Pedro', countedAt: t2 },
    { onSheet: true, countedBy: 'Carlos', countedAt: t1 },
    { onSheet: true, countedBy: 'carlos ', countedAt: t2 },
    { onSheet: false, countedBy: null, countedAt: null },
  ])
  assert.deepEqual(passes.map((p) => [p.name, p.lines]), [['Carlos', 2], ['Pedro', 1]])
  assert.equal(passes[0].at, t1.toISOString())
  assert.equal(rollupPreppedBy(passes), 'Carlos, Pedro')
  assert.equal(rollupPreppedBy([]), null)
})

console.log(`\n${pass} passed`)
