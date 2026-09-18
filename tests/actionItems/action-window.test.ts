/**
 * Action Items — the pickup window, the per-job COI merge, and the
 * replacement-cost fold.
 *
 *   npm run test:action-window
 *
 * Pure + offline. Wes 2026-09-17: rows read as stale because they were
 * labelled by the record's creation date, a COI showed once per booking,
 * and the catalog-pricing backlog showed as 71 tasks.
 */

import {
  PICKUP_WINDOW_DAYS,
  REPLACEMENT_URGENT_DAYS,
  compareActionItems,
  daysUntil,
  dueLabel,
  groupCoiByJob,
  inPickupWindow,
  priorityForBacklog,
  replacementBacklogSubtitle,
  splitReplacementGroups,
  startOfUtcDay,
} from '../../src/lib/actionItems/rules'
import type { ActionItem } from '../../src/lib/actionItems/types'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  if (got === want) console.log(`  ok — ${why}`)
  else failures.push(`${why}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}

const TODAY = new Date('2026-09-17T00:00:00.000Z')
const day = (n: number) => new Date(TODAY.getTime() + n * 86_400_000)

console.log('The window')
eq(startOfUtcDay(new Date('2026-09-17T23:59:59.000Z')).toISOString(), TODAY.toISOString(), 'a late evening is still that day')
eq(daysUntil(day(4), TODAY), 4, 'four days out')
eq(daysUntil(new Date('2026-09-21T18:30:00.000Z'), TODAY), 4, 'a pickup at 6:30pm is still four days out, not 4.77')
eq(daysUntil(day(-1), TODAY), -1, 'yesterday is -1')
eq(inPickupWindow(TODAY, TODAY), true, 'the morning of pickup still shows (2026-08-31 ruling)')
eq(inPickupWindow(day(-1), TODAY), false, 'the day after pickup it is gone')
eq(inPickupWindow(day(PICKUP_WINDOW_DAYS), TODAY), true, 'the last day of the window is in')
eq(inPickupWindow(day(PICKUP_WINDOW_DAYS + 1), TODAY), false, 'one day past the window is out')
eq(inPickupWindow(day(42), TODAY), false, 'a pickup six weeks out is not this week’s work')
eq(inPickupWindow(null, TODAY), false, 'no date, no window')

console.log('The label')
eq(dueLabel(TODAY, TODAY), 'pickup today', 'today')
eq(dueLabel(day(1), TODAY), 'pickup tomorrow', 'tomorrow')
eq(dueLabel(day(4), TODAY), 'pickup in 4d', 'inside the window: a count')
eq(dueLabel(day(20), TODAY), 'pickup Oct 7', 'past the window: a date (defensive — the window hides these)')
eq(dueLabel(day(-1), TODAY), 'went out yesterday', 'yesterday, defensively')
eq(dueLabel(day(-3), TODAY), 'went out 3d ago', 'days ago, defensively')

console.log('The sort')
const base: Omit<ActionItem, 'id' | 'priority' | 'occurredAt' | 'dueAt'> = {
  type: 't', title: '', subtitle: '', ownerRole: ['ADMIN'], href: null, source: 's', dismissal: { kind: 'sideRow' },
}
const mk = (id: string, priority: ActionItem['priority'], occurredAt: Date, dueAt?: Date | null): ActionItem =>
  ({ ...base, id, priority, occurredAt, dueAt })
const sorted = [
  mk('quiet-old', 'medium', day(-30)),
  mk('coi-far', 'medium', day(-1), day(12)),
  mk('coi-near', 'medium', day(-40), day(2)),
  mk('rejected', 'high', day(-5), day(9)),
  mk('quiet-new', 'medium', day(-2)),
].sort(compareActionItems).map((i) => i.id)
eq(sorted.join(','), 'rejected,coi-near,coi-far,quiet-new,quiet-old', 'priority, then soonest pickup (a 40-day-old booking picking up in 2d beats one booked yesterday for 12d out), then newest record')

console.log('COI: one row per job')
const rows = [
  { id: 'b2', jobId: 'J1', startDate: day(9), createdAt: day(-1) },
  { id: 'b1', jobId: 'J1', startDate: day(3), createdAt: day(-20) },
  { id: 'b3', jobId: null, startDate: day(5), createdAt: day(-2) },
  { id: 'b4', jobId: 'J2', startDate: day(1), createdAt: day(-3) },
]
const groups = groupCoiByJob(rows)
eq(groups.length, 3, 'four bookings on two jobs and one orphan → three rows (Digital Paradigm was two)')
eq(groups.map((g) => g.lead.id).join(','), 'b4,b1,b3', 'ordered by the lead’s pickup; the lead on J1 is the SOONER booking, not the newer one')
eq(groups[1].bookings.map((b) => b.id).join(','), 'b1,b2', 'the job’s bookings ride along, soonest first')
eq(groupCoiByJob([rows[1], rows[0]])[0].lead.id, 'b1', 'input order does not change the lead (dismissal key stays stable)')
const tie = groupCoiByJob([
  { id: 'z', jobId: 'J', startDate: day(3) },
  { id: 'a', jobId: 'J', startDate: day(3) },
])
eq(tie[0].lead.id, 'a', 'same-day bookings: the lower id leads, every load')

console.log('Replacement cost: the exceptions and one backlog')
const g = (key: string, type: string, soonest: Date | null, extra?: Partial<{ partner: boolean }>) => ({
  key,
  inventoryItemId: key.startsWith('item:') ? key.slice(5) : null,
  type,
  description: key,
  partner: extra?.partner ?? false,
  soonest,
  orderCount: 1,
})
const split = splitReplacementGroups(
  [
    g('item:strip', 'EQUIPMENT', day(1)),
    g('item:cube', 'VEHICLE', day(REPLACEMENT_URGENT_DAYS)),
    g('item:stake', 'VEHICLE', day(REPLACEMENT_URGENT_DAYS + 1)),
    g('item:cube-out', 'VEHICLE', day(-1)),
    g('line:blue tarp', 'EQUIPMENT', day(2)),
    g('item:gen', 'EQUIPMENT', null, { partner: true }),
    g('item:van', 'VEHICLE', day(2)),
  ],
  TODAY,
)
eq(split.urgent.map((x) => x.key).join(','), 'item:van,item:cube', 'only VEHICLE rows going out inside the week stand alone, soonest first')
eq(split.catalogBacklog.map((x) => x.key).join(','), 'item:cube-out,item:strip,item:stake,item:gen', 'everything else with a catalog row folds, soonest first — including a truck already out (its order has not ended; it never stands alone) and a partner unit')
eq(split.freeTyped.map((x) => x.key).join(','), 'line:blue tarp', 'a free-typed line is the agent’s, not the catalog’s')
eq(split.urgent.length + split.catalogBacklog.length + split.freeTyped.length, 7, 'nothing is dropped by the fold')
eq(
  replacementBacklogSubtitle(split.catalogBacklog, TODAY),
  '4 catalog rows on upcoming orders have no replacement cost (2 vehicles, 1 from a partner, 2 going out inside 14 days) — price them in the wizard, soonest pickup first',
  'the one line says how big, what kind, and how soon',
)
eq(replacementBacklogSubtitle([g('item:x', 'EQUIPMENT', day(40))], TODAY), '1 catalog row on upcoming orders has no replacement cost — price it in the wizard, soonest pickup first', 'nothing to detail → no parenthesis; singular reads as singular')
eq(priorityForBacklog(split.catalogBacklog, TODAY), 'medium', 'something in it goes out this fortnight → medium')
eq(priorityForBacklog([g('item:x', 'EQUIPMENT', day(40))], TODAY), 'low', 'all far out → low; the backlog never lights the red badge')

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log('\nall good')
