/**
 * Unit-scan decisions — what a label scanned at the check-out / check-in
 * desk does to the order (barcode phase 3).
 *
 *   npx tsx tests/warehouse/unit-scans.test.ts
 *   npm run test:unit-scans
 *
 * Pure + offline: no DB. `recordUnitScan` (unitScans.ts) loads the order
 * and the unit's open rows and hands them to decideOut / decideIn; these
 * are the outcomes it executes, so every branch here is a real thing
 * that happens at the dock.
 *
 * Both failure directions cost something. Refuse too much and the
 * supervisor stops scanning and counts by eye — the thing this exists
 * to replace. Accept too much and a walkie is filed on the wrong order,
 * and the next crew is told it is "still out on S260910-002".
 */

import assert from 'node:assert'
import type { ScanResolution } from '../../src/lib/warehouse/resolveScan'
import {
  decideIn, decideOut, summarizeUnitScans,
  type LiveScan, type ScanLine,
} from '../../src/lib/warehouse/unitScanRules'

// ── Fixtures ─────────────────────────────────────────────────────────

const RADIO = 'item-cp200'
const HAZER = 'item-hazer'

const lines: ScanLine[] = [
  { orderLineItemId: 'l-radios', inventoryItemId: RADIO, description: 'Motorola CP200 Radio', quantity: 2, sortOrder: 0 },
  { orderLineItemId: 'l-hazer', inventoryItemId: HAZER, description: 'Hazer', quantity: 1, sortOrder: 1 },
  { orderLineItemId: 'l-tape', inventoryItemId: 'item-tape', description: 'Gaff tape', quantity: 10, sortOrder: 2 },
]

const unit = (id: string, barcode: string, itemId: string | null, description = 'MOTOROLA CP200'): ScanResolution =>
  itemId
    ? {
        kind: 'unit',
        inventoryItemId: itemId,
        code: '103828',
        scanned: barcode,
        unit: { id, barcode, description, status: 'IN', rwICode: '103828' },
      }
    : {
        kind: 'unlinked-unit',
        scanned: barcode,
        unit: { id, barcode, description, rwICode: '999' },
      }

const R1 = unit('u1', 'SR000001', RADIO)
const R2 = unit('u2', 'SR000002', RADIO)
const R3 = unit('u3', 'SR000003', RADIO)
const H1 = unit('u9', 'SR000009', HAZER, 'HAZER DF-50')
const GENSET = unit('u77', 'SR000077', 'item-genset', 'HONDA EU7000')

const live = (over: Partial<LiveScan> & { id: string; inventoryUnitId: string }): LiveScan => ({
  orderId: 'o-this',
  orderNumber: 'S260911-001',
  orderLineItemId: 'l-radios',
  barcode: 'SR00000X',
  outScannedAt: new Date('2026-09-11T15:00:00Z'),
  inScannedAt: null,
  ...over,
})

const ctx = (over: Partial<Parameters<typeof decideOut>[1]> = {}) => ({
  lines, thisOrder: [], openElsewhere: null, ...over,
})

// ── OUT ──────────────────────────────────────────────────────────────

console.log('\nOUT — the label is not a unit')
{
  const d = decideOut({ kind: 'unknown', scanned: 'ZZZ' }, ctx())
  assert.equal(d.kind, 'refuse')
  assert.equal(d.kind === 'refuse' && d.code, 'unknown')
  assert.equal(d.kind === 'refuse' && d.override, null)
  console.log('  ok — an unknown label is refused with no override')
}
{
  const d = decideOut({ kind: 'catalog', inventoryItemId: RADIO, code: '103828', scanned: '103828' }, ctx())
  assert.equal(d.kind === 'refuse' && d.code, 'not-a-unit')
  console.log('  ok — a catalog code names the product, not a unit; refused')
}
{
  const d = decideOut(unit('ux', 'SR000099', null), ctx())
  assert.equal(d.kind === 'refuse' && d.code, 'unlinked-unit')
  console.log('  ok — a register unit with no catalog match is refused (reconcile the item)')
}

console.log('\nOUT — landing on a line')
{
  const d = decideOut(R1, ctx())
  assert.equal(d.kind, 'attach')
  assert.equal(d.kind === 'attach' && d.orderLineItemId, 'l-radios')
  assert.equal(d.kind === 'attach' && d.over, false)
  assert.deepEqual(d.kind === 'attach' && d.position, { n: 1, of: 2 })
  console.log('  ok — the first radio lands on the radio line as 1 of 2')
}
{
  const d = decideOut(R2, ctx({ thisOrder: [live({ id: 's1', inventoryUnitId: 'u1' })] }))
  assert.deepEqual(d.kind === 'attach' && d.position, { n: 2, of: 2 })
  console.log('  ok — the second radio is 2 of 2')
}
{
  const d = decideOut(R1, ctx({ thisOrder: [live({ id: 's1', inventoryUnitId: 'u1' })] }))
  assert.equal(d.kind, 'duplicate')
  assert.deepEqual(d.kind === 'duplicate' && d.position, { n: 1, of: 2 })
  console.log('  ok — the same radio scanned twice is a duplicate, not a second unit')
}
{
  const full = [live({ id: 's1', inventoryUnitId: 'u1' }), live({ id: 's2', inventoryUnitId: 'u2' })]
  const d = decideOut(R3, ctx({ thisOrder: full }))
  assert.equal(d.kind === 'refuse' && d.code, 'line-full')
  assert.equal(d.kind === 'refuse' && d.override, 'allowOver')
  const forced = decideOut(R3, ctx({ thisOrder: full, allowOver: true }))
  assert.equal(forced.kind, 'attach')
  assert.equal(forced.kind === 'attach' && forced.over, true)
  assert.deepEqual(forced.kind === 'attach' && forced.position, { n: 3, of: 2 })
  console.log('  ok — a third radio on a 2-radio line is refused, and goes through as over with allowOver')
}
{
  const d = decideOut(GENSET, ctx())
  assert.equal(d.kind === 'refuse' && d.code, 'not-on-order')
  assert.equal(d.kind === 'refuse' && d.override, 'allowOver')
  const forced = decideOut(GENSET, ctx({ allowOver: true }))
  assert.equal(forced.kind === 'attach' && forced.orderLineItemId, null)
  assert.equal(forced.kind === 'attach' && forced.over, true)
  console.log('  ok — a generator with no line is refused, and goes out UNLISTED with allowOver')
}
{
  // A returned trip on this order does not block a second trip.
  const done = [live({ id: 's0', inventoryUnitId: 'u1', inScannedAt: new Date('2026-09-11T20:00:00Z') })]
  const d = decideOut(R1, ctx({ thisOrder: done }))
  assert.equal(d.kind, 'attach')
  console.log('  ok — a radio that came back can go out again on the same order')
}

console.log('\nOUT — the unit is still open on another order')
{
  const elsewhere = live({ id: 's-other', inventoryUnitId: 'u1', orderId: 'o-other', orderNumber: 'S260910-002' })
  const d = decideOut(R1, ctx({ openElsewhere: elsewhere }))
  assert.equal(d.kind === 'refuse' && d.code, 'out-elsewhere')
  assert.equal(d.kind === 'refuse' && d.override, 'closeOpen')
  assert.equal(d.kind === 'refuse' && d.openOn?.orderNumber, 'S260910-002')
  assert.ok(d.kind === 'refuse' && d.reason.includes('S260910-002'), 'the refusal names the order')
  const forced = decideOut(R1, ctx({ openElsewhere: elsewhere, closeOpen: true }))
  assert.equal(forced.kind, 'attach')
  assert.equal(forced.kind === 'attach' && forced.closeScanId, 's-other')
  assert.equal(forced.kind === 'attach' && forced.closeOnOrderNumber, 'S260910-002')
  assert.equal(forced.kind === 'attach' && forced.over, false)
  console.log('  ok — refused naming the order; closeOpen closes that row and lands here')
}
{
  // allowOver alone does NOT bypass the other-order check.
  const elsewhere = live({ id: 's-other', inventoryUnitId: 'u1', orderId: 'o-other', orderNumber: 'S260910-002' })
  const d = decideOut(R1, ctx({ openElsewhere: elsewhere, allowOver: true }))
  assert.equal(d.kind === 'refuse' && d.code, 'out-elsewhere')
  console.log('  ok — allowOver is not a licence to take a unit off another order')
}

// ── IN ───────────────────────────────────────────────────────────────

console.log('\nIN — closing the trip')
{
  const d = decideIn(R1, ctx({ thisOrder: [live({ id: 's1', inventoryUnitId: 'u1' })] }))
  assert.equal(d.kind, 'close')
  assert.equal(d.kind === 'close' && d.scanId, 's1')
  assert.equal(d.kind === 'close' && d.onThisOrder, true)
  console.log('  ok — a radio out on this order is marked back')
}
{
  const back = [live({ id: 's1', inventoryUnitId: 'u1', inScannedAt: new Date() })]
  const d = decideIn(R1, ctx({ thisOrder: back }))
  assert.equal(d.kind, 'duplicate')
  console.log('  ok — scanning it in twice is a duplicate')
}
{
  const d = decideIn(H1, ctx())
  assert.equal(d.kind, 'attach-in')
  assert.equal(d.kind === 'attach-in' && d.orderLineItemId, 'l-hazer')
  console.log('  ok — a hazer never scanned out is still recorded back, on the hazer line')
}
{
  const d = decideIn(GENSET, ctx())
  assert.equal(d.kind === 'attach-in' && d.orderLineItemId, null)
  console.log('  ok — a unit on no line is recorded back unlisted rather than refused')
}
{
  const elsewhere = live({ id: 's-other', inventoryUnitId: 'u1', orderId: 'o-other', orderNumber: 'S260910-002' })
  const d = decideIn(R1, ctx({ openElsewhere: elsewhere }))
  assert.equal(d.kind === 'refuse' && d.code, 'out-elsewhere')
  assert.equal(d.kind === 'refuse' && d.override, 'closeOpen')
  const forced = decideIn(R1, ctx({ openElsewhere: elsewhere, closeOpen: true }))
  assert.equal(forced.kind === 'close' && forced.scanId, 's-other')
  assert.equal(forced.kind === 'close' && forced.onThisOrder, false)
  assert.equal(forced.kind === 'close' && forced.onOrderNumber, 'S260910-002')
  console.log('  ok — out on another order: refused, and closeOpen marks it back from there')
}
{
  const d = decideIn({ kind: 'catalog', inventoryItemId: RADIO, code: '103828', scanned: '103828' }, ctx())
  assert.equal(d.kind === 'refuse' && d.code, 'not-a-unit')
  console.log('  ok — the non-unit refusals apply on the IN edge too')
}

// ── Summary ──────────────────────────────────────────────────────────

console.log('\nSummary for the report screen')
{
  const t0 = new Date('2026-09-11T15:00:00Z')
  const t1 = new Date('2026-09-12T15:00:00Z')
  const rows = [
    { id: 'a', orderLineItemId: 'l-radios', barcode: 'SR000001', description: 'CP200', outScannedAt: t0, inScannedAt: t1, inImplied: false },
    { id: 'b', orderLineItemId: 'l-radios', barcode: 'SR000002', description: 'CP200', outScannedAt: t0, inScannedAt: null, inImplied: false },
    { id: 'c', orderLineItemId: 'l-hazer', barcode: 'SR000009', description: 'HAZER', outScannedAt: null, inScannedAt: t1, inImplied: false },
    { id: 'd', orderLineItemId: null, barcode: 'SR000077', description: 'GENSET', outScannedAt: t0, inScannedAt: null, inImplied: false },
    { id: 'e', orderLineItemId: 'l-deleted', barcode: 'SR000088', description: 'GONE', outScannedAt: t0, inScannedAt: null, inImplied: false },
  ]
  const s = summarizeUnitScans(['l-radios', 'l-hazer', 'l-tape'], rows)
  assert.equal(s.lines.length, 2, 'only lines with scans appear')
  const radios = s.lines.find((l) => l.orderLineItemId === 'l-radios')!
  assert.deepEqual({ out: radios.out, back: radios.back, stillOut: radios.stillOut }, { out: 2, back: 1, stillOut: 1 })
  assert.equal(radios.units.map((u) => u.barcode).join(','), 'SR000001,SR000002')
  const hazer = s.lines.find((l) => l.orderLineItemId === 'l-hazer')!
  assert.deepEqual({ out: hazer.out, back: hazer.back, stillOut: hazer.stillOut }, { out: 0, back: 1, stillOut: 0 })
  assert.equal(s.unlisted.map((u) => u.barcode).join(','), 'SR000077,SR000088', 'no-line and deleted-line rows are unlisted')
  assert.equal(s.totalOut, 4)
  assert.equal(s.totalBack, 2)
  assert.equal(radios.units[0].inAt, t1.toISOString())
  console.log('  ok — per-line out / back / still-out, unlisted rows, and totals')
}

console.log('\n✓ unit-scan decisions hold\n')
