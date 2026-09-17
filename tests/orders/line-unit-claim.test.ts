/**
 * Two cube trucks, two orders, one job — and both lines said "no unit".
 *
 * Index Films (Wes, 2026-09-17). The booking is job-level, so the two
 * orders share ONE Cube Truck hold of quantity 2; the board filled it
 * with two trucks and `assignUnitToBookingItem` left `orderId` null
 * because it refuses to guess between two live orders. Nothing was
 * missing — nobody had said which truck was whose.
 *
 * Run: npm run test:line-unit-claim
 */
import { splitHoldUnits, coversLine, daysDiffer, day, type HoldUnitRow, type ClaimLine } from '@/lib/orders/lineUnitClaim'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

/** A BookingAssignment as the order page has it (ISO strings). */
const unit = (
  id: string,
  start: string,
  end: string,
  over: Partial<HoldUnitRow> = {},
): HoldUnitRow & { name: string } => ({
  id,
  name: id,
  status: 'ASSIGNED',
  startDate: `${start}T00:00:00.000Z`,
  endDate: `${end}T00:00:00.000Z`,
  orderId: null,
  orderLineItemId: null,
  ...over,
})

const line = (id: string, start: string, end: string, quantity = 1): ClaimLine => ({
  id,
  quantity,
  pickupDate: `${start}T00:00:00.000Z`,
  returnDate: `${end}T00:00:00.000Z`,
})

const names = (rows: { name: string }[]) => rows.map((r) => r.name)

// ── INDEX FILMS ──────────────────────────────────────────────────────
// One hold, quantity 2. Two trucks picked on the board, neither
// attached to an order (two live orders → the server would not guess).
// Order A line wants 1 cube, order B line wants 1 cube, same days.
const cube27 = unit('Cube 27', '2026-09-21', '2026-09-25')
const cube34 = unit('Cube 34', '2026-09-21', '2026-09-25')
const lineA = line('line-A', '2026-09-21', '2026-09-25')
const lineB = line('line-B', '2026-09-21', '2026-09-25')

const a = splitHoldUnits({ assignments: [cube27, cube34], orderId: 'order-A', line: lineA })
const b = splitHoldUnits({ assignments: [cube27, cube34], orderId: 'order-B', line: lineB })
eq('Index Films · order A owns nothing yet', names(a.mine), [])
eq('Index Films · order A is offered both trucks', names(a.unclaimed), ['Cube 27', 'Cube 34'])
eq('Index Films · order B owns nothing yet', names(b.mine), [])
eq('Index Films · order B is offered both trucks', names(b.unclaimed), ['Cube 27', 'Cube 34'])

// Wes attaches Cube 27 to order A's line. Order B is then offered only
// the truck still going spare — the whole point of attaching.
const cube27Claimed = { ...cube27, orderId: 'order-A', orderLineItemId: 'line-A' }
const afterA = splitHoldUnits({ assignments: [cube27Claimed, cube34], orderId: 'order-A', line: lineA })
const afterB = splitHoldUnits({ assignments: [cube27Claimed, cube34], orderId: 'order-B', line: lineB })
eq('after attaching · A prints Cube 27', names(afterA.mine), ['Cube 27'])
eq('after attaching · A is offered the spare', names(afterA.unclaimed), ['Cube 34'])
eq('after attaching · B still owns nothing', names(afterB.mine), [])
eq("after attaching · A's truck is not offered to B", names(afterB.unclaimed), ['Cube 34'])

// ── The stamp wins, and never leaks sideways ─────────────────────────
eq('a stamped unit prints on its line', names(splitHoldUnits({
  assignments: [unit('Cube 12', '2026-09-21', '2026-09-25', { orderId: 'order-A', orderLineItemId: 'line-A' })],
  orderId: 'order-A', line: lineA,
}).mine), ['Cube 12'])
eq('stamped reports stamped', splitHoldUnits({
  assignments: [unit('Cube 12', '2026-09-21', '2026-09-25', { orderId: 'order-A', orderLineItemId: 'line-A' })],
  orderId: 'order-A', line: lineA,
}).stamped, true)
eq("another line's stamped truck is never offered", names(splitHoldUnits({
  assignments: [unit('Cube 12', '2026-09-21', '2026-09-25', { orderId: 'order-A', orderLineItemId: 'line-A' })],
  orderId: 'order-B', line: lineB,
}).unclaimed), [])

// A truck going out on a SIBLING order is that order's, not spare.
eq("a sibling order's truck is not offered", names(splitHoldUnits({
  assignments: [unit('Cube 12', '2026-09-21', '2026-09-25', { orderId: 'order-A' })],
  orderId: 'order-B', line: lineB,
}).unclaimed), [])

// ── The legacy fallback (rows bound before the line stamp existed) ────
eq('legacy: this order, exact days, prints', names(splitHoldUnits({
  assignments: [unit('Cube 12', '2026-09-21', '2026-09-25', { orderId: 'order-A' })],
  orderId: 'order-A', line: lineA,
}).mine), ['Cube 12'])
eq('legacy: it is not ALSO offered as spare', names(splitHoldUnits({
  assignments: [unit('Cube 12', '2026-09-21', '2026-09-25', { orderId: 'order-A' })],
  orderId: 'order-A', line: lineA,
}).unclaimed), [])
// Capped at the line's quantity — the surplus is genuinely spare.
const twoOnOneLine = splitHoldUnits({
  assignments: [unit('Cube 12', '2026-09-21', '2026-09-25', { orderId: 'order-A' }),
                unit('Cube 13', '2026-09-21', '2026-09-25', { orderId: 'order-A' })],
  orderId: 'order-A', line: lineA,
})
eq('legacy: capped at quantity 1', names(twoOnOneLine.mine), ['Cube 12'])
eq('legacy: the surplus is offered', names(twoOnOneLine.unclaimed), ['Cube 13'])

// A sibling LINE of the same order on the same hold keeps its own block.
const lineA2 = line('line-A2', '2026-09-28', '2026-09-30')
const siblingSplit = splitHoldUnits({
  assignments: [unit('Cube 12', '2026-09-21', '2026-09-25', { orderId: 'order-A' }),
                unit('Cube 13', '2026-09-28', '2026-09-30', { orderId: 'order-A' })],
  orderId: 'order-A', line: lineA, siblingLines: [lineA, lineA2],
})
eq("a sibling LINE's block is not offered here", names(siblingSplit.unclaimed), [])
eq('each line prints its own block', names(siblingSplit.mine), ['Cube 12'])

// ── The other drift: the dates moved and the truck did not ───────────
// Order A's own truck, one day off the line. It is NOT `mine` (the
// fallback is exact), so before this rule the row said "no unit" while
// the truck sat on the reservation. Now it is offered, and the row can
// say the days differ.
const drifted = unit('Cube 12', '2026-09-22', '2026-09-25', { orderId: 'order-A' })
const driftSplit = splitHoldUnits({ assignments: [drifted], orderId: 'order-A', line: lineA })
eq('a drifted truck does not silently print', names(driftSplit.mine), [])
eq('a drifted truck is offered', names(driftSplit.unclaimed), ['Cube 12'])
eq('daysDiffer flags it', daysDiffer(drifted, lineA), true)
eq('daysDiffer is quiet on an exact match', daysDiffer(cube27, lineA), false)

// ── Live only ────────────────────────────────────────────────────────
eq('a returned truck is neither owned nor offered', splitHoldUnits({
  assignments: [unit('Cube 12', '2026-09-21', '2026-09-25', { status: 'RETURNED' })],
  orderId: 'order-A', line: lineA,
}), { mine: [], stamped: false, unclaimed: [] })
eq('a checked-out truck still counts', names(splitHoldUnits({
  assignments: [unit('Cube 12', '2026-09-21', '2026-09-25', { status: 'CHECKED_OUT', orderId: 'order-A', orderLineItemId: 'line-A' })],
  orderId: 'order-A', line: lineA,
}).mine), ['Cube 12'])

// ── Shapes ───────────────────────────────────────────────────────────
eq('empty hold', splitHoldUnits({ assignments: [], orderId: 'order-A', line: lineA }), { mine: [], stamped: false, unclaimed: [] })
eq('a line with no dates owns nothing but is still offered the spare', names(splitHoldUnits({
  assignments: [unit('Cube 12', '2026-09-21', '2026-09-25')],
  orderId: 'order-A', line: { id: 'line-X', quantity: 1, pickupDate: null, returnDate: null },
}).unclaimed), ['Cube 12'])
eq('coversLine needs both ends', coversLine(cube27, { id: 'x', quantity: 1, pickupDate: '2026-09-21', returnDate: null }), false)

// Dates: UTC, never local. A Date and its ISO string read the same day.
eq('day() from a Date', day(new Date('2026-09-21T00:00:00Z')), '2026-09-21')
eq('day() from an ISO string', day('2026-09-21T00:00:00.000Z'), '2026-09-21')
eq('day() of nothing', day(null), null)

console.log(fail === 0 ? '\nAll line-unit-claim checks passed.' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
