/**
 * Reserved-assets rows — one per RESERVATION, not one per unit.
 *
 *   npx tsx tests/jobs/reserved-assets.test.ts
 *   npm run test:reserved-assets
 *
 * Pure + offline. The fixture is Wrong Number (SR-JOB-0273) as it stood on
 * 2026-09-15: three Passenger Vans going out Sep 16 on one booking, and
 * Pass 10 ALSO out Sep 3 on an older Planyo cart for the same job. Keyed per
 * asset and first-wins, Pass 10's Sep 16 trip vanished behind its Sep 3 one —
 * the gantt drew three bars on the 16th while the job tile showed two, plus a
 * van dated twelve days earlier with no order chip.
 */

import {
  buildReservedAssets,
  DEAD_ORDER_STATUSES,
  isLiveAssignment,
  type ReservedAssetSourceBooking,
} from '../../src/lib/jobs/reservedAssets'

const failures: string[] = []
const ok = (why: string) => console.log(`  ok — ${why}`)
const bad = (why: string) => failures.push(why)

const live = { id: 'ord-005', orderNumber: 'S260915-005', status: 'BOOKED' }
const dead = { id: 'ord-004', orderNumber: 'S260915-004', status: 'CANCELLED' }

const asn = (
  id: string,
  unitName: string,
  startDate: string,
  endDate: string,
  extra: Partial<{ status: string; order: typeof live | null }> = {},
) => ({
  id,
  startDate,
  endDate,
  status: extra.status ?? 'ASSIGNED',
  asset: { id: `asset-${unitName.toLowerCase().replace(/\s+/g, '-')}`, unitName },
  order: extra.order ?? null,
})

const wrongNumber: ReservedAssetSourceBooking[] = [
  {
    id: 'bk-planyo-sep3',
    status: 'CONFIRMED',
    items: [
      { category: { name: 'Passenger Van' }, assignments: [asn('a1', 'Pass 10', '2026-09-03', '2026-09-03')] },
    ],
  },
  {
    id: 'bk-native',
    status: 'CONFIRMED',
    items: [
      {
        category: { name: 'Passenger Van' },
        assignments: [
          asn('a2', 'Pass 8', '2026-09-16', '2026-09-16', { order: live }),
          asn('a3', 'Pass 9', '2026-09-16', '2026-09-16', { order: live }),
          asn('a4', 'Pass 10', '2026-09-16', '2026-09-16', { order: live }),
        ],
      },
      {
        category: { name: 'SuperCube Truck' },
        assignments: [asn('a5', 'Cube 25', '2026-09-10', '2026-10-03')],
      },
    ],
  },
]

const rows = buildReservedAssets(wrongNumber)

// The bug, stated directly: all three vans going out on the 16th are rows.
const sep16Vans = rows.filter((r) => r.startDate === '2026-09-16' && r.category === 'Passenger Van')
if (sep16Vans.length === 3) ok('all three vans going out Sep 16 get a row')
else bad(`expected 3 vans on Sep 16, got ${sep16Vans.length} — a reservation is being collapsed`)

// …and the earlier trip of the SAME van is still its own row, not overwritten.
const pass10 = rows.filter((r) => r.unitName === 'Pass 10')
if (pass10.length === 2) ok('Pass 10 taken twice on one job reads as two reservations')
else bad(`expected 2 Pass 10 rows (Sep 3 and Sep 16), got ${pass10.length}`)
if (pass10[0]?.startDate === '2026-09-03' && pass10[1]?.startDate === '2026-09-16') {
  ok('a unit taken twice reads in the order it goes out')
} else {
  bad('Pass 10 rows are not sorted by window')
}

// Every row must carry its OWN assignment id — that is what the Drivers card
// keys on, so a shared or missing one silently loses a driver row.
const asnIds = new Set(rows.map((r) => r.bookingAssignmentId))
if (asnIds.size === rows.length) ok('every row carries a distinct bookingAssignmentId')
else bad('rows share a bookingAssignmentId — the Drivers card would lose one')

// A unit taken off the job is history, not a reservation.
const withSwapped = buildReservedAssets([
  {
    id: 'bk-x',
    status: 'CONFIRMED',
    items: [
      {
        category: { name: 'SuperCube Truck' },
        assignments: [
          asn('s1', 'Cube 34', '2026-09-10', '2026-10-03', { status: 'SWAPPED' }),
          asn('s2', 'Cube 25', '2026-09-10', '2026-10-03'),
        ],
      },
    ],
  },
])
if (withSwapped.length === 1 && withSwapped[0].unitName === 'Cube 25') {
  ok('a SWAPPED unit is history, not a reserved asset')
} else {
  bad('SWAPPED assignments are leaking into the tile')
}

// A swapped row must never shadow the LIVE assignment for the same unit —
// the failure the per-asset map made possible in both directions.
const swappedFirst = buildReservedAssets([
  {
    id: 'bk-y',
    status: 'CONFIRMED',
    items: [
      {
        category: { name: 'Passenger Van' },
        assignments: [
          asn('t1', 'Pass 7', '2026-09-12', '2026-09-12', { status: 'SWAPPED' }),
          asn('t2', 'Pass 7', '2026-09-16', '2026-09-16', { order: live }),
        ],
      },
    ],
  },
])
if (swappedFirst.length === 1 && swappedFirst[0].startDate === '2026-09-16') {
  ok('a swapped row does not shadow the live assignment for that unit')
} else {
  bad('a swapped row is shadowing the live assignment')
}

// Cancelled and archived bookings hold nothing.
const dropped = buildReservedAssets([
  { id: 'bk-c', status: 'CANCELLED', items: [{ category: { name: 'Passenger Van' }, assignments: [asn('c1', 'Pass 1', '2026-09-16', '2026-09-16')] }] },
  { id: 'bk-a', status: 'ARCHIVED', items: [{ category: { name: 'Passenger Van' }, assignments: [asn('c2', 'Pass 2', '2026-09-16', '2026-09-16')] }] },
])
if (dropped.length === 0) ok('cancelled and archived bookings contribute no rows')
else bad('a cancelled or archived booking is still producing rows')

// The order stamp travels with its status, so the tile can say a chip is dead
// rather than presenting a cancelled order as the plan.
const stamped = buildReservedAssets([
  {
    id: 'bk-z',
    status: 'CONFIRMED',
    items: [
      {
        category: { name: 'Passenger Van' },
        assignments: [asn('d1', 'Pass 8', '2026-09-16', '2026-09-16', { order: dead })],
      },
    ],
  },
])
if (stamped[0]?.attachedOrder?.status === 'CANCELLED') ok('the order stamp carries its status')
else bad('attachedOrder dropped the order status — a dead chip would read as live')
// CANCELLED is the only dead value on OrderStatus — LOST is OrderQuoteStatus
// and VOID is an invoice status, so a set naming either would be a build error
// against Prisma. CLOSED is live-enough: that order really did take the units.
if (DEAD_ORDER_STATUSES.has('CANCELLED')) ok('a cancelled order counts as dead')
else bad('CANCELLED must count as a dead order')
for (const live of ['BOOKED', 'CLOSED', 'RETURNED', 'INVOICED', 'DRAFT']) {
  if (DEAD_ORDER_STATUSES.has(live)) bad(`${live} must never be treated as a dead order`)
}
ok('booked, closed, returned, invoiced and draft are not dead')

// The rule itself, now that four surfaces read it rather than one. Wes held
// two SuperCubes on S260918-012 by accident (2026-09-18), took Cube 5 off, and
// the order page's "Reserved units" card went on naming it: it unioned the
// job's assignments raw while the job tiles had always skipped SWAPPED.
if (!isLiveAssignment('SWAPPED')) ok('a swapped assignment is not a unit the job still has')
else bad('SWAPPED must never read as a live assignment')
for (const s of ['ASSIGNED', 'CHECKED_OUT', 'RETURNED']) {
  // RETURNED included on purpose: that truck really did go out.
  if (!isLiveAssignment(s)) bad(`${s} must read as a live assignment`)
}
ok('assigned, checked out and returned all read as live')

// The category id rides along so a tile can find its class photo
// (lib/fleet/categoryPhotos) — the job page pictures its reservations the
// way the client portal does (Wes 2026-09-18).
const withCategoryId = buildReservedAssets([
  {
    id: 'bk-photo',
    status: 'CONFIRMED',
    items: [
      {
        category: { id: 'cat-passenger-van', name: 'Passenger Van' },
        assignments: [asn('p1', 'Pass 8', '2026-09-16', '2026-09-16')],
      },
    ],
  },
])
if (withCategoryId[0]?.categoryId === 'cat-passenger-van') ok('the row carries its category id')
else bad('categoryId dropped — the tile cannot find its class photo')
// A source that never selected it is not an error; the tile falls back to its icon.
if (buildReservedAssets(wrongNumber)[0]?.categoryId === null) ok('an unselected category id reads null, not undefined')
else bad('a missing category id must read null')

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All reserved-assets checks passed.')
