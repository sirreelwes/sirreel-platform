/**
 * The owner numbers page: calendar edges and the money definitions. Each case
 * here is a way the page could show a confident, wrong number.
 */
import assert from 'node:assert/strict'
import {
  dateOnlyKey,
  lastWeeks,
  monthToDate,
  pacificDayKey,
  weekKey,
} from '@/lib/exec/periods'
import { isOwnerNumbersViewer } from '@/lib/exec/ownerAllowlist'
import { summarizeOwnerNumbers, type OwnerRows } from '@/lib/exec/ownerNumbers'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

// ── Gate ─────────────────────────────────────────────────────────────────
test('only Wes — Dani is ADMIN too and must not pass', () => {
  assert.equal(isOwnerNumbersViewer('wes@sirreel.com'), true)
  assert.equal(isOwnerNumbersViewer('  Wes@SirReel.com '), true)
  assert.equal(isOwnerNumbersViewer('dani@sirreel.com'), false)
  assert.equal(isOwnerNumbersViewer('ana@sirreel.com'), false)
  assert.equal(isOwnerNumbersViewer(null), false)
  assert.equal(isOwnerNumbersViewer(''), false)
})

// ── Calendar ─────────────────────────────────────────────────────────────
test('an evening in LA is still that day, not tomorrow UTC', () => {
  assert.equal(pacificDayKey(new Date('2026-09-16T05:30:00Z')), '2026-09-15')
  assert.equal(pacificDayKey(new Date('2026-01-01T07:59:00Z')), '2025-12-31')
})

test('a date-only invoice date is not shifted into the previous day', () => {
  assert.equal(dateOnlyKey(new Date('2026-09-01T00:00:00Z')), '2026-09-01')
})

test('month-to-date compares like days, clamped to the shorter month', () => {
  assert.deepEqual(monthToDate('2026-09-15', 0), { start: '2026-09-01', end: '2026-09-16' })
  assert.deepEqual(monthToDate('2026-09-15', 1), { start: '2026-08-01', end: '2026-08-16' })
  assert.deepEqual(monthToDate('2026-03-31', 1), { start: '2026-02-01', end: '2026-03-01' })
  assert.deepEqual(monthToDate('2026-01-10', 1), { start: '2025-12-01', end: '2025-12-11' })
  assert.deepEqual(monthToDate('2026-09-15', 12), { start: '2025-09-01', end: '2025-09-16' })
})

test('weeks start Monday and end with the current week', () => {
  assert.equal(weekKey('2026-09-15'), '2026-09-14') // Tuesday
  assert.equal(weekKey('2026-09-13'), '2026-09-07') // Sunday
  const w = lastWeeks('2026-09-15', 3)
  assert.deepEqual(w, ['2026-08-31', '2026-09-07', '2026-09-14'])
})

// ── Definitions ──────────────────────────────────────────────────────────
const D = (iso: string) => new Date(iso)
const base = (): OwnerRows => ({
  orders: [],
  rwInvoices: [],
  hqInvoices: [],
  paidObservations: [],
  trackingSince: D('2026-08-19T18:00:00Z'),
  payments: [],
  openRw: [],
  pipeline: { openQuotes: { count: 0, value: 0 }, wonNotBooked: { count: 0, value: 0 } },
  rwSyncedAt: null,
  rwEarliestInvoice: D('2025-07-18T00:00:00Z'),
})
const TODAY = '2026-10-15'
const headline = (rows: OwnerRows, key: string, today = TODAY) =>
  summarizeOwnerNumbers(rows, today).headlines.find((h) => h.key === key)!

test('VOID RW invoices are not invoiced; credits net against it', () => {
  const rows = base()
  rows.rwInvoices = [
    { invoiceDate: D('2026-10-02T00:00:00Z'), status: 'CLOSED', invoiceTotal: 1000, receivedTotal: 1000 },
    { invoiceDate: D('2026-10-03T00:00:00Z'), status: 'VOID', invoiceTotal: 5000, receivedTotal: 0 },
    { invoiceDate: D('2026-10-04T00:00:00Z'), status: 'NEW', invoiceTotal: -200, receivedTotal: 0 },
  ]
  const h = headline(rows, 'invoiced')
  assert.equal(h.value, 800)
  assert.equal(h.count, 2)
})

test('HQ drafts are not invoiced; a sent HQ invoice is, on its sent day', () => {
  const rows = base()
  rows.hqInvoices = [
    { sentAt: null, createdAt: D('2026-10-05T18:00:00Z'), status: 'DRAFT', total: 900, amountPaid: 0, balanceDue: 900, customerName: 'A' },
    { sentAt: D('2026-10-06T18:00:00Z'), createdAt: D('2026-09-20T18:00:00Z'), status: 'SENT', total: 400, amountPaid: 0, balanceDue: 400, customerName: 'B' },
  ]
  assert.equal(headline(rows, 'invoiced').value, 400)
})

test('a cancelled order is a new order but never booked; booked uses the snapshot', () => {
  const rows = base()
  const o = { quoteSentAt: null, agentName: 'Jose Pacheco' }
  rows.orders = [
    { ...o, createdAt: D('2026-10-02T18:00:00Z'), wonAt: D('2026-10-03T18:00:00Z'), status: 'CANCELLED', total: 5000, bookedTotal: null },
    { ...o, createdAt: D('2026-10-02T18:00:00Z'), wonAt: D('2026-10-03T18:00:00Z'), status: 'BOOKED', total: 1500, bookedTotal: 1200 },
    { ...o, createdAt: D('2026-10-02T18:00:00Z'), wonAt: D('2026-10-03T18:00:00Z'), status: 'APPROVED', total: 300, bookedTotal: null },
  ]
  assert.equal(headline(rows, 'orders').value, 3)
  const won = headline(rows, 'won')
  assert.equal(won.value, 1500)
  assert.equal(won.count, 2)
})

test('sales comparisons are hidden while last month predates HQ holding the book', () => {
  assert.equal(headline(base(), 'orders', '2026-09-15').prior, null)
  assert.equal(headline(base(), 'orders', '2026-10-15').prior, 0)
})

test('collections: weeks before tracking are no data, not $0', () => {
  const rows = base()
  rows.paidObservations = [{ observedPaidAt: D('2026-08-20T18:00:00Z'), invoiceTotal: 700 }]
  rows.payments = [{ receivedAt: D('2026-08-21T18:00:00Z'), amount: 50 }]
  const weeks = summarizeOwnerNumbers(rows, '2026-09-15').collections.weeks
  assert.equal(weeks.find((w) => w.week === '2026-08-10')!.total, null)
  assert.equal(weeks.find((w) => w.week === '2026-08-17')!.total, 750)
  assert.equal(weeks.find((w) => w.week === '2026-09-14')!.total, 0)
  // And no prior-month comparison while last month began before tracking.
  assert.equal(headline(rows, 'collected', '2026-09-15').prior, null)
})

test('invoiced last-year comparison needs mirror history, not just fetched rows', () => {
  const rows = base()
  assert.notEqual(headline(rows, 'invoiced', '2026-09-15').lastYear, null)
  rows.rwEarliestInvoice = D('2025-10-01T00:00:00Z')
  assert.equal(headline(rows, 'invoiced', '2026-09-15').lastYear, null)
})

test('open AR ages from the invoice date and skips paid HQ invoices', () => {
  const rows = base()
  rows.openRw = [
    { invoiceDate: D('2026-10-10T00:00:00Z'), remainingTotal: 100, customerName: 'Figs, Inc' },
    { invoiceDate: D('2026-07-01T00:00:00Z'), remainingTotal: 300, customerName: 'Figs, Inc' },
  ]
  rows.hqInvoices = [
    { sentAt: D('2026-09-01T18:00:00Z'), createdAt: D('2026-09-01T18:00:00Z'), status: 'PAID', total: 900, amountPaid: 900, balanceDue: 0, customerName: 'Paid Co' },
    { sentAt: D('2026-08-20T18:00:00Z'), createdAt: D('2026-08-20T18:00:00Z'), status: 'PARTIAL', total: 900, amountPaid: 400, balanceDue: 500, customerName: 'Part Co' },
  ]
  const c = summarizeOwnerNumbers(rows, TODAY).collections
  assert.equal(c.openTotal, 900)
  assert.equal(c.aging.find((b) => b.key === '0-30')!.amount, 100)
  assert.equal(c.aging.find((b) => b.key === '31-60')!.amount, 500)
  assert.equal(c.aging.find((b) => b.key === '90+')!.amount, 300)
  assert.deepEqual(c.topOwing.map((o) => o.name), ['Part Co', 'Figs, Inc'])
  assert.equal(c.topOwing[1].oldestDays, 106)
})

console.log(`\n${passed} passed`)
