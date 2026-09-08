/**
 * Released-fleet badge + partner release notice tests.
 *
 *   npx tsx tests/jobs/hold-release.test.ts
 *   npm run test:hold-release
 *
 * Pure + offline. Two things this guards, both of which would be wrong in
 * a way nobody notices until a truck is double-booked:
 *
 *  1. holdsFullyReleased() must NOT fire on a partial release. A job that
 *     gave back the restroom trailer and kept the motorhome is not
 *     released, and a tile saying otherwise tells dispatch a unit is free
 *     when it is still committed.
 *  2. The partner's release email must carry the one-tap confirm link, so
 *     "we told them" and "they know" stay separable facts in HQ.
 */
import { holdsFullyReleased, type JobRow } from '../../src/lib/jobs/listRow'
import { buildVendorCancelledNotice } from '../../src/lib/sub-rentals/vendorNotice'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) console.log(`  ok — ${why}`)
  else { console.log(`  FAIL — ${why}\n      got  ${g}\n      want ${w}`); failures.push(why) }
}
function ok(cond: boolean, why: string): void {
  eq(cond, true, why)
}

const today = '2026-09-08'
const future = '2026-09-20'
const past = '2026-05-01'

const job = (over: Partial<JobRow>): JobRow =>
  ({
    id: 'j1', jobCode: 'SR-JOB-0235', assistantAuthCode: null, name: 'X Zzirit',
    status: 'ACTIVE', startDate: null, createdAt: '2026-08-27T00:00:00.000Z', endDate: null,
    orderTotal: 3414, rwInvoicedTotal: 0, rwOrderCount: 0, estimatedValue: null,
    company: null, agent: null, primaryContact: null,
    ...over,
  }) as JobRow

console.log('\nholdsFullyReleased — the badge only fires on a COMPLETE release')
ok(
  holdsFullyReleased(job({ releasedHolds: { ours: 2, partner: 1, live: 0, windowEnd: future } }), today),
  'everything handed back, dates still ahead → released',
)
eq(
  holdsFullyReleased(job({ releasedHolds: { ours: 1, partner: 0, live: 1, windowEnd: future } }), today),
  false,
  'PARTIAL release (trailer back, motorhome kept) is NOT released',
)
eq(
  holdsFullyReleased(job({ releasedHolds: { ours: 0, partner: 0, live: 3, windowEnd: future } }), today),
  false,
  'nothing released at all → no badge',
)
eq(
  holdsFullyReleased(job({ releasedHolds: { ours: 0, partner: 0, live: 0, windowEnd: future } }), today),
  false,
  'a job that never held anything is not "released"',
)
eq(
  holdsFullyReleased(job({ releasedHolds: { ours: 4, partner: 0, live: 0, windowEnd: past } }), today),
  false,
  'a Planyo-era cart released back in May does not shout in red today',
)
eq(
  holdsFullyReleased(job({ releasedHolds: { ours: 1, partner: 0, live: 0, windowEnd: today } }), today),
  true,
  'a release freeing TODAY still counts — the dates are live until midnight',
)
eq(
  holdsFullyReleased(
    job({ returnedAt: '2026-09-07T00:00:00.000Z', releasedHolds: { ours: 2, partner: 0, live: 0, windowEnd: future } }),
    today,
  ),
  false,
  'gear that came home is RETURNED, not released — the two must not collide',
)
eq(holdsFullyReleased(job({}), today), false, 'a row from an older API payload (no counts) never badges')

console.log('\nbuildVendorCancelledNotice — the partner can acknowledge in one tap')
const withPage = buildVendorCancelledNotice({
  vendorName: 'King Kong Production Vehicles',
  vehicleName: 'Restroom Trailer',
  startDate: '2026-09-20',
  endDate: '2026-09-24',
  quantity: 1,
  reference: 'SR-JOB-0235',
  vendorUrl: 'https://hq.sirreel.com/vendor/abc123',
  agentName: 'Wes Bailey',
})
ok(withPage.html.includes('https://hq.sirreel.com/vendor/abc123?ack=release'), 'HTML carries the confirm link')
ok(withPage.text.includes('https://hq.sirreel.com/vendor/abc123?ack=release'), 'plain text carries it too')
ok(/Confirm you have the dates back/.test(withPage.html), 'the button says what it does')

// A row with no vendor page must still produce a valid email — it just
// can't offer the button. Rendering "undefined?ack=release" into a live
// partner's inbox is the failure this guards.
const noPage = buildVendorCancelledNotice({
  vendorName: 'King Kong Production Vehicles',
  vehicleName: 'Restroom Trailer',
  startDate: '2026-09-20',
  endDate: '2026-09-24',
  quantity: 1,
  reference: null,
  vendorUrl: '',
  agentName: 'Wes Bailey',
})
eq(noPage.html.includes('ack=release'), false, 'no vendor page → no confirm button, no broken link')
ok(noPage.html.includes('is released'), 'the release still reads as a release without the button')

console.log('')
if (failures.length) {
  console.log(`${failures.length} FAILED`)
  process.exit(1)
}
console.log('all passed')
