/**
 * Guards the two rules the merged yard board exists for.
 *
 * 1. A truck and a pick list for the SAME show land in ONE group. That
 *    is the whole point of merging the lanes — if the grouping key ever
 *    stops matching (say FleetMovement.jobId gets dropped from the
 *    query again), the board silently degrades back into two parallel
 *    lists that happen to share a page, and nothing would fail.
 *
 * 2. A vehicle due back is neither done nor to-do. HQ has no return-side
 *    inspection, so the row is informational; the first cut marked it
 *    `done`, which made every return group tick itself green and
 *    collapse as if someone had received the truck.
 *
 * Pure functions only — no database.
 */

import assert from 'node:assert'
import { assemble, vehicleEntry, gearEntry, type GearList } from '../../src/lib/yard/board'
import type { FleetMovement } from '../../src/lib/fleet/todayBoard'

const JOB = 'job-holy-water'

const truck = (over: Partial<FleetMovement> = {}): FleetMovement => ({
  assignmentId: 'a1',
  jobId: JOB,
  unitName: 'Cargo 37',
  category: 'Cargo Van w/ Liftgate',
  bookingNumber: 'SR-2026-0042',
  jobName: 'Holy Water',
  company: 'Peacoat Productions LLC',
  deliveryTime: '7:00a',
  pickupTime: '6:00p',
  inspection: null,
  ...over,
})

const cart = (over: Partial<GearList> = {}): GearList => ({
  id: 'p1',
  status: 'DRAFT',
  assignedTo: null,
  orderId: 'o1',
  orderNumber: 'S260826-003',
  jobId: JOB,
  jobName: 'Holy Water',
  company: 'Peacoat Productions LLC',
  total: 9,
  outDone: 0,
  inDone: 0,
  short: 0,
  ...over,
})

let failures = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failures += 1
    console.error(`  ✗ ${name}\n    ${err instanceof Error ? err.message : err}`)
  }
}

console.log('yard board grouping')

check('a truck and its gear share one group when the job matches', () => {
  const groups = assemble([vehicleEntry(truck(), 'out'), gearEntry(cart(), 'out')])
  assert.equal(groups.length, 1, `expected 1 group, got ${groups.length}`)
  assert.deepEqual(
    groups[0].rows.map((r) => r.kind),
    ['VEHICLE', 'GEAR'],
    'vehicle should sort above gear inside a group',
  )
  assert.equal(groups[0].openCount, 2)
  assert.equal(groups[0].done, false)
})

check('different jobs stay apart', () => {
  const groups = assemble([
    vehicleEntry(truck(), 'out'),
    gearEntry(cart({ jobId: 'job-other', jobName: 'Something Else', company: 'Other Co' }), 'out'),
  ])
  assert.equal(groups.length, 2)
})

check('a jobless booking still groups on name + company', () => {
  const groups = assemble([
    vehicleEntry(truck({ jobId: null }), 'out'),
    vehicleEntry(truck({ jobId: null, assignmentId: 'a2', unitName: 'Cube 12' }), 'out'),
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].rows.length, 2)
})

check('a vehicle due back is neither done nor to-do', () => {
  const [g] = assemble([vehicleEntry(truck(), 'back')])
  assert.equal(g.rows[0].state, 'info')
  assert.equal(g.openCount, 0, 'a due-back truck is not work the crew can clear')
  assert.equal(g.done, false, 'a due-back truck must not tick the group green')
})

check('an inspected truck going out IS done', () => {
  const [g] = assemble([
    vehicleEntry(
      truck({ inspection: { id: 'i1', inspectionDate: new Date().toISOString(), inspectorName: 'Julian Reyes' } }),
      'out',
    ),
  ])
  assert.equal(g.rows[0].state, 'done')
  assert.equal(g.done, true)
  assert.match(g.rows[0].stateLabel, /Julian/)
})

check('a short count flags rather than passing as done', () => {
  const [g] = assemble([gearEntry(cart({ status: 'CHECKED_IN', total: 9, inDone: 9, short: 2 }), 'back')])
  assert.equal(g.rows[0].state, 'flag')
  assert.equal(g.rows[0].stateLabel, '2 short')
  // Nothing left to do, but the group is finished — the flag is the
  // record, not an open task.
  assert.equal(g.openCount, 0)
  assert.equal(g.done, true)
  // ...but the group must NOT collapse to a clean green tick over it.
  assert.equal(g.flagCount, 1)
})

check('loaded gear is done outbound but still to-do inbound', () => {
  const loaded = cart({ status: 'LOADED', outDone: 9 })
  assert.equal(gearEntry(loaded, 'out').row.state, 'done')
  const back = gearEntry(loaded, 'back').row
  assert.equal(back.state, 'todo')
  assert.equal(back.action, 'Count')
})

check('groups with open work sort above informational ones', () => {
  const groups = assemble([
    vehicleEntry(truck({ assignmentId: 'a9', jobId: 'job-quiet', jobName: 'Quiet Show', company: 'Q Co' }), 'back'),
    vehicleEntry(truck(), 'out'),
  ])
  assert.equal(groups[0].jobName, 'Holy Water', 'work first')
  assert.equal(groups[1].jobName, 'Quiet Show')
})

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
