/**
 * Guards the two rules the merged yard board exists for.
 *
 * 1. A truck and a pick list for the SAME show land in ONE group. That
 *    is the whole point of merging the lanes — if the grouping key ever
 *    stops matching (say FleetMovement.jobId gets dropped from the
 *    query again), the board silently degrades back into two parallel
 *    lists that happen to share a page, and nothing would fail.
 *
 * 2. A vehicle due back is WORK until someone checks it in, and points
 *    at /fleet/return rather than the pre-rental walkaround. The first
 *    cut marked it `done`, which made every return group tick itself
 *    green as if the truck had been received; the second made it a
 *    neutral placeholder because no return flow existed yet. It does
 *    now, so the row has to behave like every other piece of work.
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
  attachedOrder: null,
  inspection: null,
  returnInspection: null,
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
  outFiled: false,
  inFiled: false,
  reportShort: 0,
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

check('a vehicle due back is work, pointed at the return screen', () => {
  const [g] = assemble([vehicleEntry(truck(), 'back')])
  const row = g.rows[0]
  assert.equal(row.state, 'todo')
  assert.equal(row.action, 'Check in')
  assert.equal(row.stateLabel, 'Due back')
  assert.match(row.href, /^\/fleet\/return\//, 'must not send the crew to the pre-rental walkaround')
  assert.equal(g.openCount, 1)
  assert.equal(g.done, false)
})

check('a checked-in vehicle is done and credited', () => {
  const [g] = assemble([
    vehicleEntry(
      truck({
        returnInspection: { id: 'r1', inspectionDate: new Date().toISOString(), inspectorName: 'Chris Valencia' },
      }),
      'back',
    ),
  ])
  assert.equal(g.rows[0].state, 'done')
  assert.equal(g.rows[0].stateLabel, 'Checked in · Chris')
  assert.equal(g.rows[0].action, 'View')
  assert.equal(g.openCount, 0)
  assert.equal(g.done, true)
})

check('a return inspection does not mark the OUTBOUND row done', () => {
  // Same assignment, going-out edge: only the checkout walkaround
  // clears that side. Crossing the two would hide an uninspected
  // departure behind yesterday's return.
  const [g] = assemble([
    vehicleEntry(
      truck({
        returnInspection: { id: 'r1', inspectionDate: new Date().toISOString(), inspectorName: 'Chris' },
      }),
      'out',
    ),
  ])
  assert.equal(g.rows[0].state, 'todo')
  assert.equal(g.rows[0].stateLabel, 'Needs inspection')
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

check('gear rows send the crew to the check report, not the scan session', () => {
  // Wes, 2026-09-04. The floor pulls on paper, so the board's one
  // action per gear row is the sheet — and the printer icon rides
  // along because that is where the paper comes from.
  const out = gearEntry(cart(), 'out').row
  assert.equal(out.action, 'Check out')
  assert.equal(out.href, '/reports/orders/o1?edge=OUT')
  assert.equal(out.printHref, '/api/orders/o1/pick-list-pdf')
  const back = gearEntry(cart(), 'back').row
  assert.equal(back.action, 'Check in')
  assert.equal(back.href, '/reports/orders/o1?edge=IN')
})

check('a loaded cart with no sheet typed in is NOT done', () => {
  // The pick list reaching LOADED used to close the outbound row on its
  // own. Under paper that is the wrong finish line: the supervisor
  // still has a marked-up sheet in their hand, and a green row is how
  // it never gets entered.
  const loaded = cart({ status: 'LOADED', outDone: 9 })
  const row = gearEntry(loaded, 'out').row
  assert.equal(row.state, 'doing')
  assert.equal(row.action, 'Check out')
  assert.match(row.stateLabel, /enter the sheet/)
})

check('a filed check-out sheet closes the outbound row', () => {
  const row = gearEntry(cart({ status: 'LOADED', outDone: 9, outFiled: true }), 'out').row
  assert.equal(row.state, 'done')
  assert.equal(row.stateLabel, 'Checked out')
  assert.equal(row.action, 'View sheet')
  // ...and says nothing about the return: that edge has its own sheet.
  const back = gearEntry(cart({ status: 'LOADED', outFiled: true }), 'back').row
  assert.equal(back.state, 'todo')
  assert.equal(back.action, 'Check in')
})

check('a filed check-in sheet with shortfalls flags rather than passing', () => {
  const [g] = assemble([
    gearEntry(cart({ status: 'LOADED', inFiled: true, reportShort: 2 }), 'back'),
  ])
  assert.equal(g.rows[0].state, 'flag')
  assert.equal(g.rows[0].stateLabel, '2 short')
  assert.equal(g.openCount, 0)
  assert.equal(g.flagCount, 1, 'a short count must not collapse behind a green tick')
})

check('groups with open work sort above finished ones', () => {
  const groups = assemble([
    vehicleEntry(
      truck({
        assignmentId: 'a9',
        jobId: 'job-quiet',
        jobName: 'Quiet Show',
        company: 'Q Co',
        returnInspection: { id: 'r', inspectionDate: new Date().toISOString(), inspectorName: 'Chris' },
      }),
      'back',
    ),
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
