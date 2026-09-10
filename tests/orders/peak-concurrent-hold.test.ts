/**
 * How many units of one category a quote actually needs at once.
 *
 * The hold builder used to sum the quoted lines. USC Short Film
 * Production quoted ONE cargo van for three separate four-day blocks and
 * got a 3-van hold across eighteen days — the fixture below.
 *
 * Run: npm run test:peak-hold
 */
import { peakConcurrent, type HoldWindow } from '@/lib/orders/peakConcurrentHold'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
/** A dated line, the way a @db.Date column comes back: UTC midnight. */
const w = (start: string, end: string, quantity = 1): HoldWindow => ({
  start: new Date(`${start}T00:00:00Z`),
  end: new Date(`${end}T00:00:00Z`),
  quantity,
})

// ── SR-JOB-0344 / S260910-002 — one van, three blocks ──
eq('USC: three sequential blocks are ONE van', peakConcurrent([
  w('2026-09-18', '2026-09-21'),
  w('2026-09-25', '2026-09-28'),
  w('2026-10-02', '2026-10-05'),
]), 1)

// ── S260903-002 High Horses — two vans that genuinely overlap ──
eq('High Horses: overlapping lines still sum', peakConcurrent([
  w('2026-09-23', '2026-09-26'),
  w('2026-09-22', '2026-09-25'),
]), 2)

// ── Shapes ──
eq('empty', peakConcurrent([]), 0)
eq('one line', peakConcurrent([w('2026-09-18', '2026-09-21')]), 1)
eq('one line, quantity 3', peakConcurrent([w('2026-09-18', '2026-09-21', 3)]), 3)
eq('identical windows add', peakConcurrent([
  w('2026-09-18', '2026-09-21'),
  w('2026-09-18', '2026-09-21'),
]), 2)
eq('a nested window adds', peakConcurrent([
  w('2026-09-18', '2026-10-05'),
  w('2026-09-25', '2026-09-28'),
]), 2)

// A same-day handoff is TWO — one van cannot return and leave on the
// same day, and that call belongs to dispatch, not to a hold.
eq('touching endpoints are concurrent', peakConcurrent([
  w('2026-09-18', '2026-09-21'),
  w('2026-09-21', '2026-09-24'),
]), 2)
eq('one day apart is not', peakConcurrent([
  w('2026-09-18', '2026-09-21'),
  w('2026-09-22', '2026-09-25'),
]), 1)

// The peak need not be at the first window, and quantities ride along.
eq('peak in the middle of a chain', peakConcurrent([
  w('2026-09-01', '2026-09-03'),
  w('2026-09-05', '2026-09-20', 2),
  w('2026-09-10', '2026-09-12', 2),
  w('2026-09-25', '2026-09-27'),
]), 4)

// Order of the lines must not matter.
const mixed = [w('2026-10-02', '2026-10-05'), w('2026-09-18', '2026-09-21'), w('2026-09-25', '2026-09-28')]
eq('order-independent', peakConcurrent(mixed), peakConcurrent([...mixed].reverse()))

console.log(fail === 0 ? '\nall peak-concurrent checks passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
