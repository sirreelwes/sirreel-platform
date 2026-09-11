/**
 * Partner-added photos — live at once, HQ told (Wes 2026-09-11).
 *
 *   · shouldNotifyHq: one email per burst — the first photo tells HQ, the
 *     five that follow within ten minutes do not, the one an hour later does.
 *   · groupNewPartnerPhotos: one item per UNIT, newest first, carrying every
 *     photo id in the group so "all look good" clears exactly those.
 *
 * Run: npm run test:partner-photos
 */
import { shouldNotifyHq, groupNewPartnerPhotos, PARTNER_PHOTO_NOTIFY_WINDOW_MS } from '@/lib/sub-rentals/partnerPhotos'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

const t0 = new Date('2026-09-11T20:00:00Z')
const plus = (ms: number) => new Date(t0.getTime() + ms)
eq('first photo on a unit notifies', shouldNotifyHq(null, t0), true)
eq('second photo 30s later does not', shouldNotifyHq(t0, plus(30_000)), false)
eq('a photo at the window edge does not', shouldNotifyHq(t0, plus(PARTNER_PHOTO_NOTIFY_WINDOW_MS)), false)
eq('a photo an hour later notifies again', shouldNotifyHq(t0, plus(60 * 60_000)), true)

const kk = { id: 'v-kk', name: 'King Kong' }
const pt = { id: 'v-pt', name: 'PowerTrip Rentals' }
const rows = [
  { id: 'p1', uploadedByPartnerAt: plus(0), vehicle: { id: 'gen100', name: 'Studio Generator — 100 kW', vendor: pt } },
  { id: 'p2', uploadedByPartnerAt: plus(5_000), vehicle: { id: 'gen100', name: 'Studio Generator — 100 kW', vendor: pt } },
  { id: 'p3', uploadedByPartnerAt: plus(90_000), vehicle: { id: 'star', name: '2-Room Star Wagon', vendor: kk } },
  { id: 'p4', uploadedByPartnerAt: plus(2_000), vehicle: { id: 'lift', name: 'Scissor Lift — 19 ft', vendor: pt } },
]
const groups = groupNewPartnerPhotos(rows)
eq('one group per unit', groups.length, 3)
eq('newest group first', groups.map((g) => g.unitId), ['star', 'gen100', 'lift'])
eq('generator group carries both photo ids', groups.find((g) => g.unitId === 'gen100')!.photoIds, ['p1', 'p2'])
eq('generator group count', groups.find((g) => g.unitId === 'gen100')!.count, 2)
eq('generator group latest is the second upload', groups.find((g) => g.unitId === 'gen100')!.latestAt.toISOString(), plus(5_000).toISOString())
eq('vendor carried on the group', groups.find((g) => g.unitId === 'star')!.vendorName, 'King Kong')
eq('empty in, empty out', groupNewPartnerPhotos([]), [])

console.log(fail === 0 ? '\nall good' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
