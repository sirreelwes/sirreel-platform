/**
 * The check-in sheet as Wes described it on 2026-09-18: a door that only
 * opens when the order is back, a count of what came back with damage as
 * its own number, and a report somebody sends either way.
 *
 * Three things are pinned here because each of them decides money or
 * whether anybody goes looking for missing gear:
 *
 *   1. the gate — a check-in files RETURNED and takes the job off the
 *      board, so "it never went out" and "it isn't due yet" have to be
 *      recognised, and both have to stay passable;
 *   2. damaged vs missing — a damaged case came BACK, so it must never
 *      be counted as a shortfall (that bills a replacement for gear on
 *      our own shelf) and must never be silent (that bills nothing for a
 *      light that can't go out again);
 *   3. the delta — the sheet is replaced in place on every pass, so the
 *      email says what CHANGED, not what the sheet says.
 */

import assert from 'node:assert'
import { checkInReadiness } from '../../src/lib/orders/checkInReady'
import { damagedOnCheckIn, diffMissingGear, missingOnCheckIn, type InboundLineFacts } from '../../src/lib/invoices/ldMissingGear'
import { buildCheckInReportEmail } from '../../src/lib/email/templates/checkInReport'

let pass = 0
function check(name: string, fn: () => void) {
  fn()
  pass++
  console.log(`  ✓ ${name}`)
}

const TODAY = '2026-09-18'

console.log('\ncheckInReadiness')

check('gear that went out and is due back can be checked in', () => {
  const r = checkInReadiness({ status: 'ON_JOB', endYmd: TODAY, todayYmd: TODAY, outFiled: true })
  assert.strictEqual(r.ready, true)
  assert.strictEqual(r.block, null)
})

check('a booked order with no check-out on file never went out', () => {
  const r = checkInReadiness({ status: 'BOOKED', endYmd: TODAY, todayYmd: TODAY, outFiled: false })
  assert.strictEqual(r.ready, false)
  assert.strictEqual(r.block, 'never-went-out')
  // The way through is always offered — the sheet on the desk has to
  // land somewhere (see the module doc).
  assert.ok(r.override && r.override.length > 0)
})

check('a filed check-out is proof it left, whatever the status says', () => {
  // The paperwork routinely lags the truck: a quote-form order with a
  // typed check-out sheet has physically gone out.
  const r = checkInReadiness({ status: 'QUOTE_SENT', endYmd: TODAY, todayYmd: TODAY, outFiled: true })
  assert.strictEqual(r.ready, true)
})

check('LOADED_READY is not "it went out" — loaded is still in the building', () => {
  const r = checkInReadiness({ status: 'LOADED_READY', endYmd: TODAY, todayYmd: TODAY, outFiled: false })
  assert.strictEqual(r.block, 'never-went-out')
})

check('an order due back later is not back yet', () => {
  const r = checkInReadiness({ status: 'ON_JOB', endYmd: '2026-09-25', todayYmd: TODAY, outFiled: true })
  assert.strictEqual(r.ready, false)
  assert.strictEqual(r.block, 'not-due-back')
})

check('the last day of the rental IS a check-in day', () => {
  const r = checkInReadiness({ status: 'ON_JOB', endYmd: TODAY, todayYmd: TODAY, outFiled: true })
  assert.strictEqual(r.ready, true)
})

check('an overdue order is ready, not blocked', () => {
  const r = checkInReadiness({ status: 'ON_JOB', endYmd: '2026-09-10', todayYmd: TODAY, outFiled: true })
  assert.strictEqual(r.ready, true)
})

check('an undated order cannot be early', () => {
  const r = checkInReadiness({ status: 'ON_JOB', endYmd: null, todayYmd: TODAY, outFiled: true })
  assert.strictEqual(r.ready, true)
})

check('"it never went out" is answered before "it is not due"', () => {
  // Both are wrong on this one; the first is the one worth saying.
  const r = checkInReadiness({ status: 'DRAFT', endYmd: '2026-09-30', todayYmd: TODAY, outFiled: false })
  assert.strictEqual(r.block, 'never-went-out')
})

console.log('\ndamagedOnCheckIn')

const line = (o: Partial<InboundLineFacts> & { description: string }): InboundLineFacts => ({
  orderLineItemId: o.description,
  expectedQty: 3,
  actualQty: 3,
  damagedQty: 0,
  change: 'NONE',
  onSheet: true,
  note: null,
  ...o,
})

check('everything back and whole is neither missing nor damaged', () => {
  const lines = [line({ description: 'stinger' })]
  assert.strictEqual(missingOnCheckIn(lines).length, 0)
  assert.strictEqual(damagedOnCheckIn(lines).length, 0)
})

check('a damaged piece came BACK — it is damage, never a shortfall', () => {
  const lines = [line({ description: 'fresnel', actualQty: 3, damagedQty: 1 })]
  assert.deepStrictEqual(missingOnCheckIn(lines), [])
  const d = damagedOnCheckIn(lines)
  assert.strictEqual(d.length, 1)
  assert.strictEqual(d[0].damaged, 1)
  assert.strictEqual(d[0].actualQty, 3)
})

check('short AND damaged on one line reads as both, without double counting', () => {
  // Two of three back, one of those two crushed: one missing, one damaged.
  const lines = [line({ description: 'stinger', actualQty: 2, damagedQty: 1, change: 'SHORT' })]
  assert.strictEqual(missingOnCheckIn(lines)[0].missing, 1)
  assert.strictEqual(damagedOnCheckIn(lines)[0].damaged, 1)
})

check('damage is clamped to what came back', () => {
  const lines = [line({ description: 'hazer', actualQty: 1, damagedQty: 5, change: 'SHORT' })]
  assert.strictEqual(damagedOnCheckIn(lines)[0].damaged, 1)
})

check('a line nobody counted says nothing about damage', () => {
  const lines = [line({ description: 'cable', onSheet: false, damagedQty: 2 })]
  assert.deepStrictEqual(damagedOnCheckIn(lines), [])
})

check('an ADDED row has no order line to bill against', () => {
  const lines = [line({ description: 'strap', orderLineItemId: null, damagedQty: 1, change: 'ADDED' })]
  assert.deepStrictEqual(damagedOnCheckIn(lines), [])
})

console.log('\ndiffMissingGear — damage')

check('newly damaged is announced once, not on every later pass', () => {
  const before = [line({ description: 'fresnel', damagedQty: 0 })]
  const after = [line({ description: 'fresnel', damagedQty: 1 })]
  assert.strictEqual(diffMissingGear(before, after).newlyDamaged.length, 1)
  // Saving the rest of the sheet re-files the same row — silence.
  assert.strictEqual(diffMissingGear(after, after).newlyDamaged.length, 0)
})

check('finding more damage on a re-count does announce it', () => {
  const before = [line({ description: 'fresnel', damagedQty: 1 })]
  const after = [line({ description: 'fresnel', damagedQty: 2 })]
  assert.strictEqual(diffMissingGear(before, after).newlyDamaged[0].damaged, 2)
})

console.log('\nbuildCheckInReportEmail')

const reportBase = {
  orderNumber: 'S260918-001',
  jobName: 'Nightfall',
  companyName: 'Acme Pictures',
  countedBy: 'Albert',
  sentBy: 'Albert',
  filedAt: new Date('2026-09-18T23:10:00Z'),
  stillOut: [],
  notes: null,
  orderLink: 'https://hq.sirreel.com/orders/o1',
  sheetLink: 'https://hq.sirreel.com/reports/orders/o1/filed?edge=IN',
}

check('a clean return is its own report, not a missing one', () => {
  const mail = buildCheckInReportEmail({
    ...reportBase,
    lines: [
      { description: 'Walkie', expectedQty: 6, actualQty: 6, damagedQty: 0, note: null, replacementCost: 400 },
    ],
  })
  assert.ok(mail.subject.includes('everything came back'), mail.subject)
  assert.ok(mail.text.includes('S260918-001'))
  assert.ok(!mail.text.includes('NOT RETURNED'))
})

check('missing and damaged both reach the subject line', () => {
  const mail = buildCheckInReportEmail({
    ...reportBase,
    lines: [
      { description: 'Stinger', expectedQty: 3, actualQty: 2, damagedQty: 0, note: null, replacementCost: 45 },
      { description: 'Fresnel', expectedQty: 2, actualQty: 2, damagedQty: 1, note: 'lens cracked', replacementCost: 900 },
    ],
  })
  assert.ok(mail.subject.includes('1 item not returned'), mail.subject)
  assert.ok(mail.subject.includes('1 back damaged'), mail.subject)
  assert.ok(mail.text.includes('NOT RETURNED'))
  assert.ok(mail.text.includes('CAME BACK DAMAGED'))
  // The size of it, at the figures HQ holds — and never a bill.
  assert.ok(mail.text.includes('$945.00'), mail.text)
  assert.ok(mail.text.includes('Nothing has been billed.'))
})

check('lines still out are not reported as missing', () => {
  const mail = buildCheckInReportEmail({
    ...reportBase,
    lines: [{ description: 'Walkie', expectedQty: 6, actualQty: 6, damagedQty: 0, note: null, replacementCost: null }],
    stillOut: [{ description: 'Genny', expectedQty: 1 }],
  })
  assert.ok(!mail.text.includes('NOT RETURNED'))
  assert.ok(mail.text.includes('STILL OUT'))
  assert.ok(!mail.subject.includes('everything came back'), mail.subject)
})

console.log(`\n${pass} checks passed\n`)
