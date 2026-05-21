/**
 * Boundary tests for the native-scheduling conflict engine.
 *
 *   npx tsx tests/scheduling/availability.test.ts
 *
 * Targets the pure `computeUnitStates` function — no DB. The
 * arithmetic that, wrong, double-books a stage is locked here.
 *
 * Coverage per native-scheduling-v1-brief.md §"CC notes":
 *   - exact-adjacent (return day = next start)   — same-day turnaround
 *   - 1-day gap with bufferDays=1                — preferred-buffer
 *   - full overlap                                — hard block
 *   - touching endpoints                          — single-day overlap
 *   - plus: assignment-after-window (symmetric buffer)
 *   - plus: zero-day-gap with bufferDays=0       — buffer disabled
 *   - plus: clearDaysBetween primitive
 */

import {
  computeUnitStates,
  clearDaysBetween,
  type AssignmentWindow,
  type ServiceableAsset,
} from '../../src/lib/scheduling/availability'

const failures: string[] = []

function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message)
  else console.log(`  ok — ${message}`)
}

/** UTC midnight Date for YYYY-MM-DD. */
function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`)
}

const asset = (id: string, name = id): ServiceableAsset => ({ id, unitName: name, tier: 'STANDARD' })
const assign = (assetId: string, startISO: string, endISO: string): AssignmentWindow => ({
  assetId,
  startDate: d(startISO),
  endDate: d(endISO),
})

// ───────────────────────────────────────────────────────────────────
console.log('clearDaysBetween primitive')
// ───────────────────────────────────────────────────────────────────
check(clearDaysBetween(d('2026-05-10'), d('2026-05-10')) === -1, 'same day → -1 (overlap)')
check(clearDaysBetween(d('2026-05-10'), d('2026-05-11')) === 0, 'consecutive days → 0 (no clear day)')
check(clearDaysBetween(d('2026-05-10'), d('2026-05-12')) === 1, '1 clear day between')
check(clearDaysBetween(d('2026-05-10'), d('2026-05-15')) === 4, '4 clear days between')

// ───────────────────────────────────────────────────────────────────
console.log('\nexact-adjacent — return day = next start (same-day turnaround)')
// ───────────────────────────────────────────────────────────────────
// Assignment ends 5/10. New window starts 5/11. With bufferDays=1 the
// gap of 0 clear days is below threshold → BUFFER (yellow, overridable).
{
  const units = computeUnitStates(
    [asset('A')],
    [assign('A', '2026-05-05', '2026-05-10')],
    d('2026-05-11'),
    d('2026-05-13'),
    1,
  )
  check(units[0].state === 'buffer', 'bufferDays=1 + 0 clear days before window → buffer')
}
{
  const units = computeUnitStates(
    [asset('A')],
    [assign('A', '2026-05-05', '2026-05-10')],
    d('2026-05-11'),
    d('2026-05-13'),
    0,
  )
  check(units[0].state === 'free', 'bufferDays=0 + 0 clear days before window → free (no buffer required)')
}

// ───────────────────────────────────────────────────────────────────
console.log('\n1-day gap with bufferDays=1 (one full clean day in between)')
// ───────────────────────────────────────────────────────────────────
// Assignment ends 5/10. New window starts 5/12. 5/11 is clear. Should
// be FREE — that's exactly the preferred buffer day.
{
  const units = computeUnitStates(
    [asset('A')],
    [assign('A', '2026-05-05', '2026-05-10')],
    d('2026-05-12'),
    d('2026-05-14'),
    1,
  )
  check(units[0].state === 'free', '1 clear day with bufferDays=1 → free')
}
// 2 clear days with bufferDays=2 → free
{
  const units = computeUnitStates(
    [asset('A')],
    [assign('A', '2026-05-05', '2026-05-10')],
    d('2026-05-13'),
    d('2026-05-14'),
    2,
  )
  check(units[0].state === 'free', '2 clear days with bufferDays=2 → free')
}
// 1 clear day with bufferDays=2 → buffer
{
  const units = computeUnitStates(
    [asset('A')],
    [assign('A', '2026-05-05', '2026-05-10')],
    d('2026-05-12'),
    d('2026-05-14'),
    2,
  )
  check(units[0].state === 'buffer', '1 clear day with bufferDays=2 → buffer (under threshold)')
}

// ───────────────────────────────────────────────────────────────────
console.log('\nfull overlap (assignment fully contains window)')
// ───────────────────────────────────────────────────────────────────
{
  const units = computeUnitStates(
    [asset('A')],
    [assign('A', '2026-05-08', '2026-05-14')],
    d('2026-05-10'),
    d('2026-05-12'),
    1,
  )
  check(units[0].state === 'booked', 'assignment fully contains window → booked')
}
{
  const units = computeUnitStates(
    [asset('A')],
    [assign('A', '2026-05-10', '2026-05-12')],
    d('2026-05-08'),
    d('2026-05-14'),
    1,
  )
  check(units[0].state === 'booked', 'window fully contains assignment → booked')
}
{
  const units = computeUnitStates(
    [asset('A')],
    [assign('A', '2026-05-09', '2026-05-13')],
    d('2026-05-10'),
    d('2026-05-12'),
    1,
  )
  check(units[0].state === 'booked', 'partial overlap (assignment straddles window start) → booked')
}

// ───────────────────────────────────────────────────────────────────
console.log('\ntouching endpoints (single-day overlap)')
// ───────────────────────────────────────────────────────────────────
// Assignment 5/01-5/10. Window starts on 5/10. Endpoint touches → hard
// overlap by the inclusive-inclusive rule.
{
  const units = computeUnitStates(
    [asset('A')],
    [assign('A', '2026-05-01', '2026-05-10')],
    d('2026-05-10'),
    d('2026-05-12'),
    1,
  )
  check(units[0].state === 'booked', 'assignment.end === window.start → booked (endpoints inclusive)')
}
// Window 5/01-5/10. Assignment starts on 5/10. Endpoint touches → hard.
{
  const units = computeUnitStates(
    [asset('A')],
    [assign('A', '2026-05-10', '2026-05-15')],
    d('2026-05-01'),
    d('2026-05-10'),
    1,
  )
  check(units[0].state === 'booked', 'window.end === assignment.start → booked (endpoints inclusive)')
}

// ───────────────────────────────────────────────────────────────────
console.log('\nsymmetric buffer — assignment AFTER the window')
// ───────────────────────────────────────────────────────────────────
{
  const units = computeUnitStates(
    [asset('A')],
    [assign('A', '2026-05-15', '2026-05-18')],
    d('2026-05-10'),
    d('2026-05-14'),
    1,
  )
  check(units[0].state === 'buffer', 'next assignment 1 day after window with bufferDays=1 → buffer')
}
{
  const units = computeUnitStates(
    [asset('A')],
    [assign('A', '2026-05-16', '2026-05-18')],
    d('2026-05-10'),
    d('2026-05-14'),
    1,
  )
  check(units[0].state === 'free', 'next assignment 2 days after window with bufferDays=1 → free')
}

// ───────────────────────────────────────────────────────────────────
console.log('\nmulti-asset + multi-assignment classification')
// ───────────────────────────────────────────────────────────────────
{
  const units = computeUnitStates(
    [asset('A', 'Cube #1'), asset('B', 'Cube #2'), asset('C', 'Cube #3')],
    [
      assign('A', '2026-05-09', '2026-05-13'), // overlaps window → booked
      assign('B', '2026-05-05', '2026-05-10'), // ends 1 day before → buffer (bufferDays=1)
      // C has no assignments → free
    ],
    d('2026-05-11'),
    d('2026-05-14'),
    1,
  )
  check(units.find((u) => u.assetId === 'A')!.state === 'booked', 'A overlaps → booked')
  check(units.find((u) => u.assetId === 'B')!.state === 'buffer', 'B same-day turnaround → buffer')
  check(units.find((u) => u.assetId === 'C')!.state === 'free', 'C no assignments → free')
}

// ───────────────────────────────────────────────────────────────────
console.log('\nhard overlap takes priority over adjacent-buffer assignments')
// ───────────────────────────────────────────────────────────────────
// Same asset has a hard overlap AND an adjacent assignment. Hard wins.
{
  const units = computeUnitStates(
    [asset('A')],
    [
      assign('A', '2026-05-12', '2026-05-13'), // hard overlap
      assign('A', '2026-04-30', '2026-05-10'), // buffer-adjacent
    ],
    d('2026-05-11'),
    d('2026-05-14'),
    1,
  )
  check(units[0].state === 'booked', 'hard overlap dominates concurrent buffer-adjacent → booked')
}

// ───────────────────────────────────────────────────────────────────
console.log('\nsingle-day window')
// ───────────────────────────────────────────────────────────────────
// Window where start === end. Assignment exactly on that day → booked.
{
  const units = computeUnitStates(
    [asset('A')],
    [assign('A', '2026-05-10', '2026-05-10')],
    d('2026-05-10'),
    d('2026-05-10'),
    1,
  )
  check(units[0].state === 'booked', 'single-day assignment on single-day window → booked')
}
// Single-day window, assignment day before → buffer at bufferDays=1
{
  const units = computeUnitStates(
    [asset('A')],
    [assign('A', '2026-05-09', '2026-05-09')],
    d('2026-05-10'),
    d('2026-05-10'),
    1,
  )
  check(units[0].state === 'buffer', 'single-day window, assignment ended day before → buffer')
}

// ───────────────────────────────────────────────────────────────────
console.log('')
if (failures.length === 0) {
  console.log(`✓ all checks passed`)
  process.exit(0)
} else {
  console.error(`✗ ${failures.length} failure(s):`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
