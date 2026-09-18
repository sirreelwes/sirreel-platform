/**
 * WHICH DAYS a unit gets bound for — the rule behind
 * `src/lib/scheduling/assignWindow.ts`.
 *
 * The regression this guards is Oliver's, 2026-09-14, on ADV Carrera
 * (SR-2026-0387): "HQ won't let me assign pass 2 on 9/29 - 9/30 because
 * pass 2 returns on 9/28." Nothing was double-booked. The order quotes a
 * passenger van from the 28th and two more from the 29th, so the ORDER
 * SPAN was 9/28 → 9/30 and the write checked Pass 2 against the day it
 * came home from another job — while the picker beside it checked the
 * HOLD window (9/29 → 9/30) and rendered the same van merely "tight".
 *
 * Both now resolve the same DATE BLOCK. The last two sections prove the
 * two halves agree, and that the earlier fix (b5799955 — a booking
 * envelope spanning two orders) still holds.
 *
 * Run: npm run test:assign-window
 */
process.env.TZ = 'America/Los_Angeles'

import {
  blockCapacity,
  coverageOfBlock,
  quotedBlocks,
  resolveAssignWindow,
  soleOrderCoveringHold,
  type QuotedBlock,
} from '@/lib/scheduling/assignWindow'
import { computeUnitStates } from '@/lib/scheduling/availability'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
const iso = (x: { start: Date; end: Date; source?: string }) =>
  `${x.start.toISOString().slice(0, 10)}→${x.end.toISOString().slice(0, 10)}${x.source ? ` (${x.source})` : ''}`
const line = (pickup: string, ret: string, quantity = 1) => ({ pickupDate: d(pickup), returnDate: d(ret), quantity })
const span = (start: string, end: string) => ({ startDate: d(start), endDate: d(end) })

// ── Blocks off the quoted lines ──────────────────────────────────────
console.log('\n— quoted blocks —')
{
  // ADV Carrera's passenger-van lines, exactly as they sit on S260914-001.
  const blocks = quotedBlocks([line('2026-09-28', '2026-09-30'), line('2026-09-29', '2026-09-30'), line('2026-09-29', '2026-09-30')])
  eq('two blocks, earliest first', blocks.map(iso), ['2026-09-28→2026-09-30', '2026-09-29→2026-09-30'])
  eq('same days are ONE block of summed qty', blocks.map((b) => b.quantity), [1, 2])
}
eq('no lines → no blocks', quotedBlocks([]).length, 0)

// ── Coverage is exact, never overlap ─────────────────────────────────
console.log('\n— block coverage —')
{
  const later: QuotedBlock = { start: d('2026-09-29'), end: d('2026-09-30'), quantity: 2 }
  // Pass 1 runs 9/28 → 9/30 for the EARLIER block. It overlaps the later
  // one; counting overlap would read this block as full and refuse the
  // second van all over again.
  eq('overlapping assignment is not coverage', coverageOfBlock(later, [span('2026-09-28', '2026-09-30')]), 0)
  eq('exact match is', coverageOfBlock(later, [span('2026-09-29', '2026-09-30')]), 1)
}

// ── The resolver ─────────────────────────────────────────────────────
console.log('\n— resolveAssignWindow —')
const advBlocks = quotedBlocks([line('2026-09-28', '2026-09-30'), line('2026-09-29', '2026-09-30'), line('2026-09-29', '2026-09-30')])
const advArgs = {
  hold: { start: d('2026-09-29'), end: d('2026-09-30') },
  orderWindow: { start: d('2026-09-28'), end: d('2026-09-30') },
  blocks: advBlocks,
}

eq(
  'ADV Carrera: the block still short of units',
  iso(resolveAssignWindow({ ...advArgs, assignments: [span('2026-09-28', '2026-09-30'), span('2026-09-29', '2026-09-30')] })),
  '2026-09-29→2026-09-30 (block-open)',
)
eq(
  'nothing assigned yet → the earliest open block',
  iso(resolveAssignWindow({ ...advArgs, assignments: [] })),
  '2026-09-28→2026-09-30 (block-open)',
)
eq(
  'the agent names the block',
  iso(resolveAssignWindow({ ...advArgs, assignments: [], requested: { start: d('2026-09-29'), end: d('2026-09-30') } })),
  '2026-09-29→2026-09-30 (requested)',
)
eq(
  'a requested block OUTSIDE the hold but inside the order is still real',
  iso(resolveAssignWindow({ ...advArgs, assignments: [], requested: { start: d('2026-09-28'), end: d('2026-09-30') } })),
  '2026-09-28→2026-09-30 (requested)',
)
eq(
  'a requested window nobody quoted is ignored',
  iso(resolveAssignWindow({ ...advArgs, assignments: [], requested: { start: d('2026-09-01'), end: d('2026-12-31') } })),
  '2026-09-28→2026-09-30 (block-open)',
)
eq(
  'one quoted block IS the window',
  iso(
    resolveAssignWindow({
      hold: { start: d('2026-09-22'), end: d('2026-10-10') },
      orderWindow: { start: d('2026-09-22'), end: d('2026-09-24') },
      blocks: quotedBlocks([line('2026-09-22', '2026-09-24')]),
    }),
  ),
  '2026-09-22→2026-09-24 (block)',
)
eq(
  'no lines: the order span clamped to the hold',
  iso(
    resolveAssignWindow({
      hold: { start: d('2026-09-29'), end: d('2026-09-30') },
      orderWindow: { start: d('2026-09-28'), end: d('2026-09-30') },
    }),
  ),
  '2026-09-29→2026-09-30 (overlap)',
)
eq(
  // Oliver, 2026-09-18, KPDH Multi Block 2: the hold said 9/18 and the
  // job's only other order — S260914-021, already out on 9/15 — said
  // 9/15, so Cargo 22 was bound to the 15th. The reservation showed on
  // the job page and the board drew the van three days in the past.
  'no lines, no overlap: the hold wins, not another week’s order',
  iso(
    resolveAssignWindow({
      hold: { start: d('2026-09-01'), end: d('2026-09-02') },
      orderWindow: { start: d('2026-10-06'), end: d('2026-10-10') },
    }),
  ),
  '2026-09-01→2026-09-02 (hold)',
)
eq(
  'a quoted block clear of the hold is not picked for it either',
  iso(
    resolveAssignWindow({
      hold: { start: d('2026-09-18'), end: d('2026-09-19') },
      orderWindow: { start: d('2026-09-24'), end: d('2026-09-25') },
      blocks: quotedBlocks([line('2026-09-24', '2026-09-25')]),
    }),
  ),
  '2026-09-18→2026-09-19 (hold)',
)
{
  // NECTARHOUSE S3 (SR-JOB-0373): ONE order quotes a cube 9/18 → 9/19 and
  // another 9/24 → 9/25; the booking envelope is the first block only.
  // Cube 32 is on both, and the second leg must still be auto-pickable —
  // the order reaches the hold, so every block on it is in play.
  const nectar = {
    hold: { start: d('2026-09-18'), end: d('2026-09-19') },
    orderWindow: { start: d('2026-09-18'), end: d('2026-09-25') },
    blocks: quotedBlocks([line('2026-09-18', '2026-09-19'), line('2026-09-24', '2026-09-25')]),
  }
  eq(
    'a second block on an order that DOES reach the hold is still picked',
    iso(resolveAssignWindow({ ...nectar, assignments: [span('2026-09-18', '2026-09-19')] })),
    '2026-09-24→2026-09-25 (block-open)',
  )
  eq(
    'and the agent can name it outright',
    iso(resolveAssignWindow({ ...nectar, requested: { start: d('2026-09-24'), end: d('2026-09-25') } })),
    '2026-09-24→2026-09-25 (requested)',
  )
}
eq(
  'lines read off an order that never reaches the hold are not its blocks',
  iso(
    resolveAssignWindow({
      hold: { start: d('2026-09-18'), end: d('2026-09-18') },
      orderWindow: { start: d('2026-09-10'), end: d('2026-09-11') },
      blocks: quotedBlocks([line('2026-09-10', '2026-09-11')]),
      assignments: [],
    }),
  ),
  '2026-09-18→2026-09-18 (hold)',
)
eq(
  'a bare hold (a gantt drag, no order) keeps its own window',
  iso(resolveAssignWindow({ hold: { start: d('2026-09-29'), end: d('2026-09-30') } })),
  '2026-09-29→2026-09-30 (hold)',
)

// ── Which ORDER the unit goes out on ─────────────────────────────────
console.log('\n— the order covering the hold —')
{
  const hold = { start: d('2026-09-18'), end: d('2026-09-18') }
  const sept15 = { id: 'o-0914', start: d('2026-09-15'), end: d('2026-09-15') }
  const sept18 = { id: 'o-0918', start: d('2026-09-18'), end: d('2026-09-18') }

  // KPDH Multi Block 2 at 16:26: one order on the job, finished and out
  // three days earlier. "The only order" is not "this hold's order".
  eq('the job’s one order, about another week → none named', soleOrderCoveringHold([sept15], hold), null)
  eq('the order whose days these are', soleOrderCoveringHold([sept15, sept18], hold), 'o-0918')
  eq('two orders over the same days → the agent picks', soleOrderCoveringHold([sept18, { ...sept18, id: 'o-other' }], hold), null)
  eq('an order with no dates says nothing', soleOrderCoveringHold([{ id: 'o-bare', start: null, end: null }], hold), null)
  eq('touching counts — a longer order that covers the hold', soleOrderCoveringHold([{ id: 'o-wide', start: d('2026-09-14'), end: d('2026-09-20') }], hold), 'o-wide')
}

// ── What the operator was actually told ──────────────────────────────
console.log('\n— the van in the yard —')
{
  // Pass 2 is out 9/22 → 9/28 on the VMA Shoot.
  const vma = [{ assetId: 'pass-2', startDate: d('2026-09-22'), endDate: d('2026-09-28'), jobName: 'VMA Shoot' }]
  const asset = [{ id: 'pass-2', unitName: 'Pass 2', tier: 'STANDARD' as const }]

  const w = resolveAssignWindow({ ...advArgs, assignments: [span('2026-09-28', '2026-09-30'), span('2026-09-29', '2026-09-30')] })
  const onBlock = computeUnitStates(asset, vma, w.start, w.end, 1)[0]
  eq('on the block Oliver was filling: tight, and assignable', onBlock.state, 'buffer')
  eq('and it says what is in the way', onBlock.conflict?.jobName, 'VMA Shoot')

  // The window the write used before this change — the whole order span.
  const onOrderSpan = computeUnitStates(asset, vma, d('2026-09-28'), d('2026-09-30'), 1)[0]
  eq('on the old order-span window: refused outright', onOrderSpan.state, 'booked')
}

// ── Is the block full? ONE answer for the picker and the write ───────
console.log('\n— block capacity —')
{
  // Jose, 2026-09-17, Mad Minds (SR-JOB-0389): Cargo 35 is on the hold for
  // 9/18 → 9/23 and Cargo 45 is on the same job with overlapping days. The
  // hold itself says quantity 1. Changing Cargo 35 was refused "fully
  // assigned" because the write counted Cargo 45's OVERLAP against the
  // hold's 1, while the picker counted exact coverage against the quote.
  const block = { start: d('2026-09-18'), end: d('2026-09-23') }
  const blocks = quotedBlocks([line('2026-09-18', '2026-09-23')])
  const cargo35 = span('2026-09-18', '2026-09-23')
  const cargo45 = span('2026-09-18', '2026-09-21')

  const full = blockCapacity({ window: block, blocks, assignments: [cargo35, cargo45], itemQuantity: 1 })
  eq('with Cargo 35 on it the block is full (1 of 1)', [full.assignedCount, full.quantity, full.remaining], [1, 1, 0])

  // The swap steps Cargo 35 aside; what stands is Cargo 45, which overlaps
  // but is not ON this block. Room for the replacement.
  const swapping = blockCapacity({ window: block, blocks, assignments: [cargo45], itemQuantity: 1 })
  eq('with Cargo 35 stepping aside, the overlap does not count', [swapping.assignedCount, swapping.remaining], [0, 1])

  // The quote grew: two cargo vans on the block, the hold still says 1.
  // The picker reads "1 of 2"; the write must agree there is a slot.
  const grown = blockCapacity({ window: block, blocks: quotedBlocks([line('2026-09-18', '2026-09-23', 2)]), assignments: [cargo35], itemQuantity: 1 })
  eq('quoted quantity wins over the hold\'s when the window is a block', [grown.quantity, grown.remaining], [2, 1])

  // No quoted lines (a bare hold): the hold's own quantity and overlap.
  const bare = blockCapacity({ window: block, blocks: [], assignments: [cargo45], itemQuantity: 1 })
  eq('no block: the hold\'s quantity, overlap counts', [bare.block, bare.quantity, bare.assignedCount, bare.remaining], [null, 1, 1, 0])

  // A window that matches no block reads the same way.
  const other = blockCapacity({ window: { start: d('2026-09-19'), end: d('2026-09-20') }, blocks, assignments: [cargo45], itemQuantity: 2 })
  eq('window off every block: item quantity, overlap', [other.block, other.quantity, other.assignedCount], [null, 2, 1])

  // A line zeroed out but still on the order quotes a block of 0. That is
  // not a block to be exact against, or every window would read full.
  const zeroed = blockCapacity({ window: block, blocks: quotedBlocks([line('2026-09-18', '2026-09-23', 0)]), assignments: [], itemQuantity: 1 })
  eq('a zero-quantity block falls back to the hold', [zeroed.block, zeroed.quantity, zeroed.remaining], [null, 1, 1])

  // ADV Carrera, the other direction: the 9/28 van overlaps the 9/29 block
  // and must not fill it.
  const later = { start: d('2026-09-29'), end: d('2026-09-30') }
  const adv = blockCapacity({ window: later, blocks: advBlocks, assignments: [span('2026-09-28', '2026-09-30')], itemQuantity: 3 })
  eq('ADV Carrera: the earlier van does not fill the later block', [adv.quantity, adv.assignedCount, adv.remaining], [2, 0, 2])
}

console.log(fail === 0 ? '\nall assign-window checks passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
