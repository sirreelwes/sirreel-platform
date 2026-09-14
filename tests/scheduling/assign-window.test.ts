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
  coverageOfBlock,
  quotedBlocks,
  resolveAssignWindow,
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
  'no lines, no overlap: the order wins',
  iso(
    resolveAssignWindow({
      hold: { start: d('2026-09-01'), end: d('2026-09-02') },
      orderWindow: { start: d('2026-10-06'), end: d('2026-10-10') },
    }),
  ),
  '2026-10-06→2026-10-10 (order)',
)
eq(
  'a bare hold (a gantt drag, no order) keeps its own window',
  iso(resolveAssignWindow({ hold: { start: d('2026-09-29'), end: d('2026-09-30') } })),
  '2026-09-29→2026-09-30 (hold)',
)

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

console.log(fail === 0 ? '\nall assign-window checks passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
