/**
 * The reservation follows the order's dates — the rule behind
 * `src/lib/scheduling/followLineDates.ts`.
 *
 * Wes, 2026-09-17, on Someday Studios' passenger van: pickup moved from
 * the 18th to the 17th on the order, and the reservation stayed on the
 * 18th. The unit's days are a COPY stamped at assign time; nothing
 * re-stamped it. These cases pin which units follow a moved block, which
 * stay and why, and where the booking envelope ends up.
 *
 * Run: npm run test:follow-line-dates
 */
process.env.TZ = 'America/Los_Angeles'

import { planAssignmentFollow, bookingEnvelopeFor, type FollowCandidate } from '@/lib/scheduling/followLineDates'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
const w = (start: string, end: string) => ({ start: d(start), end: d(end) })
const ymd = (x: Date) => x.toISOString().slice(0, 10)
const unit = (
  id: string,
  start: string,
  end: string,
  opts: { status?: string; orderId?: string | null } = {},
): FollowCandidate => ({
  id,
  assetId: `asset-${id}`,
  status: opts.status ?? 'ASSIGNED',
  startDate: d(start),
  endDate: d(end),
  orderId: opts.orderId === undefined ? 'order-A' : opts.orderId,
})
const moves = (p: ReturnType<typeof planAssignmentFollow>) => p.moves.map((m) => `${m.id}:${ymd(m.startDate)}→${ymd(m.endDate)}`)
const stays = (p: ReturnType<typeof planAssignmentFollow>) => p.stays.map((s) => `${s.id}:${s.why}`)

// ── Someday Studios: one van, pickup a day earlier ───────────────────
console.log('\n— the van follows —')
{
  const plan = planAssignmentFollow({
    from: w('2026-09-18', '2026-09-20'),
    to: w('2026-09-17', '2026-09-20'),
    quantity: 1,
    orderId: 'order-A',
    assignments: [unit('pass3', '2026-09-18', '2026-09-20')],
    otherBlocks: [],
  })
  eq('Someday Studios: Pass 3 moves to the 17th', moves(plan), ['pass3:2026-09-17→2026-09-20'])
  eq('nothing stays', stays(plan), [])
}
{
  const plan = planAssignmentFollow({
    from: w('2026-09-18', '2026-09-20'),
    to: w('2026-09-18', '2026-09-20'),
    quantity: 1,
    orderId: 'order-A',
    assignments: [unit('pass3', '2026-09-18', '2026-09-20')],
    otherBlocks: [],
  })
  eq('same days → no move', moves(plan), [])
}

// ── Two lines on one block, one moves ────────────────────────────────
console.log('\n— only the moved line’s count moves —')
{
  const plan = planAssignmentFollow({
    from: w('2026-10-01', '2026-10-03'),
    to: w('2026-10-02', '2026-10-03'),
    quantity: 1,
    orderId: 'order-A',
    assignments: [unit('c20', '2026-10-01', '2026-10-03'), unit('c21', '2026-10-01', '2026-10-03'), unit('c22', '2026-10-01', '2026-10-03')],
    otherBlocks: [w('2026-10-01', '2026-10-03')],
  })
  eq('one of three vans moves', moves(plan).length, 1)
  eq('the other two stay for the line still on the old days', stays(plan), ['c21:beyond-quantity', 'c22:beyond-quantity'])
}
{
  const plan = planAssignmentFollow({
    from: w('2026-10-01', '2026-10-03'),
    to: w('2026-10-08', '2026-10-10'),
    quantity: 2,
    orderId: 'order-A',
    assignments: [unit('c20', '2026-10-01', '2026-10-03'), unit('c21', '2026-10-01', '2026-10-03')],
    otherBlocks: [],
  })
  eq('a two-van line takes both', moves(plan), ['c20:2026-10-08→2026-10-10', 'c21:2026-10-08→2026-10-10'])
}

// ── Legacy rows: stamped with something other than the block ─────────
console.log('\n— overlap only when the block is the only one —')
{
  // Stamped with an order span (pre-09-14) that matches no block exactly.
  const plan = planAssignmentFollow({
    from: w('2026-10-05', '2026-10-06'),
    to: w('2026-10-06', '2026-10-07'),
    quantity: 1,
    orderId: 'order-A',
    assignments: [unit('cube1', '2026-10-04', '2026-10-06')],
    otherBlocks: [],
  })
  eq('single block: an overlapping legacy row follows', moves(plan), ['cube1:2026-10-06→2026-10-07'])
}
{
  const plan = planAssignmentFollow({
    from: w('2026-10-05', '2026-10-06'),
    to: w('2026-10-06', '2026-10-07'),
    quantity: 1,
    orderId: 'order-A',
    assignments: [unit('cube1', '2026-10-04', '2026-10-06')],
    otherBlocks: [w('2026-10-04', '2026-10-06')],
  })
  eq('second block on the order: the overlapping row may be its — nothing moves', moves(plan), [])
}
{
  // ADV Carrera shape: the 9/28 van overlaps the 9/29 block and must not
  // be dragged when the 9/29 block moves.
  const plan = planAssignmentFollow({
    from: w('2026-09-29', '2026-09-30'),
    to: w('2026-09-30', '2026-10-01'),
    quantity: 2,
    orderId: 'order-A',
    assignments: [unit('pass1', '2026-09-28', '2026-09-30'), unit('pass2', '2026-09-29', '2026-09-30')],
    otherBlocks: [w('2026-09-28', '2026-09-30')],
  })
  eq('ADV Carrera: only the exact-block van moves', moves(plan), ['pass2:2026-09-30→2026-10-01'])
}

// ── Checked out: the pickup already happened ─────────────────────────
console.log('\n— a unit that is out —')
{
  const plan = planAssignmentFollow({
    from: w('2026-09-15', '2026-09-18'),
    to: w('2026-09-15', '2026-09-20'),
    quantity: 1,
    orderId: 'order-A',
    assignments: [unit('cube7', '2026-09-15', '2026-09-18', { status: 'CHECKED_OUT' })],
    otherBlocks: [],
  })
  eq('return extended on a unit that is out: the return follows', moves(plan), ['cube7:2026-09-15→2026-09-20'])
}
{
  const plan = planAssignmentFollow({
    from: w('2026-09-15', '2026-09-18'),
    to: w('2026-09-16', '2026-09-18'),
    quantity: 1,
    orderId: 'order-A',
    assignments: [unit('cube7', '2026-09-15', '2026-09-18', { status: 'CHECKED_OUT' })],
    otherBlocks: [],
  })
  eq('pickup moved on a unit that is out: it stays, named', [moves(plan), stays(plan)], [[], ['cube7:checked-out']])
}
{
  const plan = planAssignmentFollow({
    from: w('2026-09-15', '2026-09-18'),
    to: w('2026-09-16', '2026-09-18'),
    quantity: 1,
    orderId: 'order-A',
    assignments: [unit('cube7', '2026-09-15', '2026-09-18', { status: 'SWAPPED' })],
    otherBlocks: [],
  })
  eq('a released (SWAPPED) row holds nothing and is ignored', [moves(plan), stays(plan)], [[], []])
}

// ── Whose unit is it ─────────────────────────────────────────────────
console.log('\n— the shared job booking —')
{
  const plan = planAssignmentFollow({
    from: w('2026-10-20', '2026-10-28'),
    to: w('2026-10-21', '2026-10-28'),
    quantity: 1,
    orderId: 'order-A',
    assignments: [unit('cubeB', '2026-10-20', '2026-10-28', { orderId: 'order-B' }), unit('cubeA', '2026-10-20', '2026-10-28')],
    otherBlocks: [],
  })
  eq('a sibling order’s unit never moves for this order', [moves(plan), stays(plan)], [['cubeA:2026-10-21→2026-10-28'], ['cubeB:other-order']])
}
{
  const plan = planAssignmentFollow({
    from: w('2026-10-20', '2026-10-28'),
    to: w('2026-10-21', '2026-10-28'),
    quantity: 1,
    orderId: 'order-A',
    assignments: [unit('unstamped', '2026-10-20', '2026-10-28', { orderId: null }), unit('cubeA', '2026-10-20', '2026-10-28')],
    otherBlocks: [],
  })
  eq('this order’s own stamped unit goes before an unstamped one', moves(plan), ['cubeA:2026-10-21→2026-10-28'])
}
{
  const plan = planAssignmentFollow({
    from: w('2026-10-20', '2026-10-28'),
    to: w('2026-10-21', '2026-10-28'),
    quantity: 1,
    orderId: 'order-A',
    assignments: [unit('unstamped', '2026-10-20', '2026-10-28', { orderId: null })],
    otherBlocks: [],
  })
  eq('an unstamped unit (a hold placed before the order) follows', moves(plan), ['unstamped:2026-10-21→2026-10-28'])
}

// ── The envelope ─────────────────────────────────────────────────────
console.log('\n— the booking envelope —')
{
  const next = bookingEnvelopeFor({
    current: w('2026-09-18', '2026-09-20'),
    lineWindows: [w('2026-09-17', '2026-09-20')],
    assignmentWindows: [w('2026-09-17', '2026-09-20')],
    bareHold: false,
  })
  eq('Someday Studios: the envelope starts the 17th', next && `${ymd(next.start)}→${ymd(next.end)}`, '2026-09-17→2026-09-20')
}
{
  const next = bookingEnvelopeFor({
    current: w('2026-09-05', '2026-09-15'),
    lineWindows: [w('2026-09-12', '2026-09-15')],
    assignmentWindows: [w('2026-09-12', '2026-09-15')],
    bareHold: false,
  })
  eq('pushed a week later: the envelope comes IN (no phantom hold on the old days)', next && `${ymd(next.start)}→${ymd(next.end)}`, '2026-09-12→2026-09-15')
}
{
  const next = bookingEnvelopeFor({
    current: w('2026-09-05', '2026-09-15'),
    lineWindows: [w('2026-09-12', '2026-09-15')],
    assignmentWindows: [],
    bareHold: true,
  })
  eq('a bare hold on the booking: widen only, never shrink', next, null)
}
{
  const next = bookingEnvelopeFor({
    current: w('2026-09-05', '2026-09-15'),
    lineWindows: [w('2026-09-12', '2026-09-18')],
    assignmentWindows: [],
    bareHold: true,
  })
  eq('a bare hold still lets the envelope widen', next && `${ymd(next.start)}→${ymd(next.end)}`, '2026-09-05→2026-09-18')
}
{
  const next = bookingEnvelopeFor({
    current: w('2026-09-05', '2026-09-15'),
    lineWindows: [w('2026-09-12', '2026-09-15')],
    assignmentWindows: [w('2026-09-05', '2026-09-08')],
    bareHold: false,
  })
  eq('a unit still on the old days keeps the envelope over them', next, null)
}
{
  eq('nothing dated → nothing written', bookingEnvelopeFor({ current: w('2026-09-05', '2026-09-15'), lineWindows: [], assignmentWindows: [], bareHold: false }), null)
}

console.log(fail === 0 ? '\nall follow-line-dates checks passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
