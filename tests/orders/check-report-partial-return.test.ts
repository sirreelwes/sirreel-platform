/**
 * Partial returns — the rules behind "5 of 10 came back so far".
 *
 * Oliver, 2026-09-12: partial returns arrive on different days of a
 * rental, and filing what came back read as "the job is done and a whole
 * bunch of stuff is missing". These guard the two pure rules that stop
 * that:
 *
 *   settleSheetLine — what an off-sheet line MEANS per edge. Inbound it
 *     keeps its running count and is never classified (so never SHORT,
 *     never flagged, never "returned"). Outbound it is untouched, as it
 *     always was. The one contradiction ("all back but still out") is
 *     read as on the sheet.
 *   countEdit — when a new count on the form has to ASK. A short inbound
 *     count on a settled line asks; one on a line already short-and-
 *     decided keeps its answer; the outbound edge never asks.
 *
 * Pure functions only — no database.
 */

import assert from 'node:assert'
import {
  countEdit, describeCheckChange, describeStillOut, settleSheetLine,
} from '../../src/lib/orders/checkLineChange'

let pass = 0
function check(name: string, fn: () => void) {
  fn()
  pass++
  console.log(`  ✓ ${name}`)
}

const line = (over: Partial<Parameters<typeof settleSheetLine>[1]> = {}) => ({
  orderLineItemId: 'li-1',
  description: 'Walkie CP200',
  expectedQty: 10,
  actualQty: 10,
  substituteFor: null,
  ...over,
})

// ── settleSheetLine ────────────────────────────────────────────────

check('IN, still out: keeps the count back so far and is never classified', () => {
  const s = settleSheetLine('IN', line({ actualQty: 5, onSheet: false }))
  assert.deepEqual(s, { actualQty: 5, change: 'NONE', onSheet: false })
})

check('IN, still out with nothing back: count 0, still NONE', () => {
  const s = settleSheetLine('IN', line({ actualQty: 0, onSheet: false }))
  assert.deepEqual(s, { actualQty: 0, change: 'NONE', onSheet: false })
})

check('IN, on the sheet and short: SHORT, as before — that is "missing"', () => {
  const s = settleSheetLine('IN', line({ actualQty: 5, onSheet: true }))
  assert.deepEqual(s, { actualQty: 5, change: 'SHORT', onSheet: true })
})

check('IN, "still out" with everything back contradicts itself → on the sheet, all back', () => {
  // The form cannot send this; a stray caller must not park a finished
  // line open, which would hold the order in Check in for ever.
  const s = settleSheetLine('IN', line({ actualQty: 10, onSheet: false }))
  assert.deepEqual(s, { actualQty: 10, change: 'NONE', onSheet: true })
})

check('IN, "still out" with MORE than expected back → on the sheet, EXTRA', () => {
  const s = settleSheetLine('IN', line({ actualQty: 12, onSheet: false }))
  assert.deepEqual(s, { actualQty: 12, change: 'EXTRA', onSheet: true })
})

check('OUT, off the sheet: untouched — actual = expected, NONE (unchanged rule)', () => {
  // A typed count on an off-sheet outbound line must NOT survive: a zero
  // here would classify REMOVED and email the client a shrunken quote.
  const s = settleSheetLine('OUT', line({ actualQty: 0, onSheet: false }))
  assert.deepEqual(s, { actualQty: 10, change: 'NONE', onSheet: false })
})

check('either edge, on the sheet: classified as before', () => {
  assert.equal(settleSheetLine('OUT', line({ actualQty: 8 })).change, 'SHORT')
  assert.equal(settleSheetLine('OUT', line({ actualQty: 0 })).change, 'REMOVED')
  assert.equal(settleSheetLine('IN', line()).change, 'NONE')
  // onSheet absent = on the sheet: every report filed before partials
  // existed still reads as a complete count.
  assert.equal(settleSheetLine('IN', line({ actualQty: 3 })).onSheet, true)
})

// ── countEdit ──────────────────────────────────────────────────────

const settled = { expectedQty: 10, actualQty: 10, onSheet: true, decided: true }

check('IN: a short count on a settled line ASKS', () => {
  assert.deepEqual(countEdit('IN', settled, 5), { actualQty: 5, onSheet: true, decided: false })
})

check('IN: a count reaching the expected quantity is all back — no question', () => {
  const stillOut = { expectedQty: 10, actualQty: 5, onSheet: false, decided: true }
  assert.deepEqual(countEdit('IN', stillOut, 10), { actualQty: 10, onSheet: true, decided: true })
})

check('IN: more than expected is settled too (EXTRA is a read-back, not a question)', () => {
  assert.deepEqual(countEdit('IN', settled, 11), { actualQty: 11, onSheet: true, decided: true })
})

check('IN: bumping a still-out line keeps it still out — more of the same, not a new question', () => {
  const stillOut = { expectedQty: 10, actualQty: 3, onSheet: false, decided: true }
  assert.deepEqual(countEdit('IN', stillOut, 5), { actualQty: 5, onSheet: false, decided: true })
})

check('IN: correcting a missing line keeps it missing', () => {
  const missing = { expectedQty: 10, actualQty: 8, onSheet: true, decided: true }
  assert.deepEqual(countEdit('IN', missing, 7), { actualQty: 7, onSheet: true, decided: true })
})

check('IN: an undecided line stays undecided while the count moves', () => {
  const asking = { expectedQty: 10, actualQty: 5, onSheet: true, decided: false }
  assert.deepEqual(countEdit('IN', asking, 6), { actualQty: 6, onSheet: true, decided: false })
})

check('IN: a negative count is clamped to zero and asks', () => {
  assert.deepEqual(countEdit('IN', settled, -2), { actualQty: 0, onSheet: true, decided: false })
})

check('OUT: never asks — a short pull rewrites the order, which is what that sheet is for', () => {
  assert.deepEqual(countEdit('OUT', settled, 5), { actualQty: 5, onSheet: true, decided: true })
  assert.deepEqual(countEdit('OUT', settled, 0), { actualQty: 0, onSheet: true, decided: true })
})

check('OUT: a count never moves a line on or off the pull (a photo read cannot undo "not this pull")', () => {
  const offPull = { expectedQty: 10, actualQty: 10, onSheet: false, decided: true }
  assert.deepEqual(countEdit('OUT', offPull, 4), { actualQty: 4, onSheet: false, decided: true })
})

// ── wording ────────────────────────────────────────────────────────

check('describeStillOut: the running total, in words', () => {
  assert.equal(describeStillOut(line({ actualQty: 5 })), 'Walkie CP200: 5 of 10 back')
  assert.equal(describeStillOut(line({ actualQty: 0 })), 'Walkie CP200: none of 10 back yet')
})

check('describeCheckChange on the IN edge speaks in return words', () => {
  assert.equal(describeCheckChange(line({ actualQty: 5 }), 'SHORT', 'IN'), 'Walkie CP200: 5 of 10 back — 5 missing')
  assert.equal(describeCheckChange(line({ actualQty: 0 }), 'REMOVED', 'IN'), 'Walkie CP200: none of 10 came back')
  assert.equal(describeCheckChange(line({ actualQty: 12 }), 'EXTRA', 'IN'), 'Walkie CP200: 10 out, 12 back')
  assert.equal(
    describeCheckChange({ orderLineItemId: null, description: 'furni pad', expectedQty: 0, actualQty: 4 }, 'ADDED', 'IN'),
    'came back with furni pad ×4',
  )
})

check('describeCheckChange defaults to the OUT wording (unchanged)', () => {
  assert.equal(describeCheckChange(line({ actualQty: 5 })), 'Walkie CP200: 10 → 5')
  assert.equal(describeCheckChange(line({ actualQty: 0 })), 'did not send Walkie CP200')
})

console.log(`\nall checks passed (${pass})`)
