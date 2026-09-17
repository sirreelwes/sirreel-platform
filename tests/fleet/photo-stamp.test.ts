/**
 * The date/time on every walk-around photo, the name a saved copy gets,
 * and the out-beside-back pairing (Hugo, 2026-09-17).
 *
 *   npx tsx tests/fleet/photo-stamp.test.ts
 *   npm run test:photo-stamp
 *
 * Pure + offline: no DB, no canvas, no env.
 *
 * Pins: the stamp is Pacific and says so; a saved file is named so a
 * folder of them sorts and reads; the compare list puts check-OUT on the left
 * whichever end was opened, walks Julian's slots in order, then the
 * loose photos out-first; and the viewer opens on the slot asked for.
 */

import {
  photoStampWhen,
  photoStampShort,
  photoStampCaption,
  photoDownloadName,
  slotTitle,
} from '../../src/lib/fleet/photoStamp'
import { buildCompareRecord, startIndex } from '../../src/lib/fleet/comparePairs'
import type { FiledInspectionDetail, FiledPhoto } from '../../src/lib/fleet/inspectionHistory'
import { REQUIRED_POSITIONS } from '../../src/lib/fleet/photoPositions'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

// 2026-09-16 21:14 UTC is 2:14 PM Pacific (PDT).
const takenAt = new Date('2026-09-16T21:14:00Z')

console.log('stamp wording')
check('full stamp is Pacific and says so', photoStampWhen(takenAt) === 'Sep 16, 2026 · 2:14 PM PT')
check('short stamp drops the year and zone', photoStampShort(takenAt) === 'Sep 16, 2:14 PM')
check(
  'caption carries unit, end, numbered slot and time',
  photoStampCaption({ unitName: 'Cube 27', edge: 'OUT', position: 'REAR_DRIVER_CORNER', takenAt }) ===
    'Cube 27 · Check-out · 5. Driver side rear · Sep 16, 2026 · 2:14 PM PT',
)
check('a sided slot names its side', slotTitle('OUT', 'WHEEL_DRIVER_REAR') === '6. Rear tire · driver side')
check('close-up has no number', slotTitle('IN', 'DAMAGE') === 'Damage close-up')
check('no position reads Other', slotTitle('IN', null) === 'Other')
check('check-in numbers agree with check-out for a shared slot', slotTitle('IN', 'REAR') === slotTitle('OUT', 'REAR'))

console.log('saved file name')
check(
  'sorts by unit, end, walk number, then time',
  photoDownloadName({ unitName: 'Cube 27', edge: 'OUT', position: 'REAR_DRIVER_CORNER', takenAt, contentType: 'image/jpeg' }) ===
    'Cube-27_check-out_05-driver-side-rear_2026-09-16_14-14.jpg',
)
check(
  'keeps the original type for a raw copy',
  photoDownloadName({ unitName: 'Cube 27', edge: 'IN', position: 'DAMAGE', takenAt, contentType: 'image/heic' }).endsWith(
    '_check-in_damage-close-up_2026-09-16_14-14.heic',
  ),
)
check(
  'a null type falls back to jpg',
  photoDownloadName({ unitName: 'Stake Bed 3', edge: 'IN', position: null, takenAt, contentType: null }) ===
    'Stake-Bed-3_check-in_other_2026-09-16_14-14.jpg',
)
check(
  'midnight is 00, not 24',
  photoDownloadName({ unitName: 'X', edge: 'OUT', position: null, takenAt: new Date('2026-09-17T07:00:00Z'), contentType: null }).includes('_00-00.'),
)

console.log('out beside back')
const photo = (id: string, position: string | null, at: string): FiledPhoto => ({ id, position, takenAt: new Date(at) })
const outShots = { REAR_DRIVER_CORNER: photo('o5', 'REAR_DRIVER_CORNER', '2026-09-10T15:00:00Z'), FRONT: photo('o12', 'FRONT', '2026-09-10T15:01:00Z') }
const inShots = { REAR_DRIVER_CORNER: photo('i5', 'REAR_DRIVER_CORNER', '2026-09-16T21:14:00Z') }
const slots = REQUIRED_POSITIONS.filter((s) => s.id !== 'DRIVERS_LICENSE').map((s) => ({ position: s.id, label: s.label, group: s.group }))

/** The filed record as the IN end sees it. */
const openedFromIn: FiledInspectionDetail = {
  inspectionId: 'in-1',
  edge: 'IN',
  inspectedAt: new Date('2026-09-16T21:30:00Z'),
  inspectorName: 'Andy',
  byDriver: false,
  unitName: 'Cube 27',
  category: 'Cube Truck',
  makeModel: null,
  licensePlate: null,
  assignmentId: 'asg-1',
  jobName: 'Acme',
  company: 'Acme Co',
  bookingNumber: 'B-1',
  startDate: null,
  endDate: null,
  condition: 'GOOD',
  mileage: null,
  fuelLevel: null,
  notes: null,
  slots: slots.map((s) => ({
    ...s,
    mine: (inShots as Record<string, FiledPhoto>)[s.position] ?? null,
    theirs: (outShots as Record<string, FiledPhoto>)[s.position] ?? null,
  })),
  damagePhotos: [photo('i-d1', 'DAMAGE', '2026-09-16T21:20:00Z')],
  otherPhotos: [],
  damage: [],
  counterpart: {
    inspectionId: 'out-1',
    edge: 'OUT',
    inspectedAt: new Date('2026-09-10T15:10:00Z'),
    inspectorName: 'Frankie',
    mileage: null,
    damagePhotos: [],
    otherPhotos: [photo('o-x1', null, '2026-09-10T15:05:00Z'), photo('o-x2', null, '2026-09-10T15:06:00Z')],
  },
  milesDriven: null,
}
const fromIn = buildCompareRecord(openedFromIn)
check('opened from the check-in, out is still on the left', fromIn.out?.inspectionId === 'out-1' && fromIn.back?.inspectionId === 'in-1')
const five = fromIn.pairs.find((p) => p.key === 'REAR_DRIVER_CORNER')
check('slot 5 pairs the out shot with the in shot', five?.out?.id === 'o5' && five?.back?.id === 'i5' && five.title === '5. Driver side rear')
const front = fromIn.pairs.find((p) => p.key === 'FRONT')
check('a slot shot on one end only keeps the other side empty', front?.out?.id === 'o12' && front?.back === null)
check('the slots come first, in the walk order', fromIn.pairs.slice(0, slots.length).every((p, i) => p.key === slots[i].position && p.slot))
const loose = fromIn.pairs.slice(slots.length)
check(
  'loose photos: out extras first, then the in close-up',
  loose.map((p) => p.key).join(',') === 'out-other-o-x1,out-other-o-x2,in-damage-i-d1',
)
check('out extras sit on the left only', loose[0].out?.id === 'o-x1' && loose[0].back === null && loose[0].title === 'Other 1')
check('in close-up sits on the right only', loose[2].back?.id === 'i-d1' && loose[2].out === null && loose[2].title === 'Damage close-up')

// The same rental opened from the OUT end must give the same list.
const openedFromOut: FiledInspectionDetail = {
  ...openedFromIn,
  inspectionId: 'out-1',
  edge: 'OUT',
  inspectorName: 'Frankie',
  slots: openedFromIn.slots.map((s) => ({ ...s, mine: s.theirs, theirs: s.mine })),
  damagePhotos: [],
  otherPhotos: openedFromIn.counterpart!.otherPhotos,
  counterpart: { ...openedFromIn.counterpart!, inspectionId: 'in-1', edge: 'IN', inspectorName: 'Andy', damagePhotos: openedFromIn.damagePhotos, otherPhotos: [] },
}
const fromOut = buildCompareRecord(openedFromOut)
check(
  'opened from either end, the pairs are identical',
  JSON.stringify(fromOut.pairs) === JSON.stringify(fromIn.pairs) && fromOut.out?.inspectorName === 'Frankie' && fromOut.back?.inspectorName === 'Andy',
)

// No counterpart: one side throughout, nothing invented.
const alone = buildCompareRecord({ ...openedFromIn, counterpart: null, slots: openedFromIn.slots.map((s) => ({ ...s, theirs: null })) })
check('with no check-out filed, out is null and every left frame is empty', alone.out === null && alone.pairs.every((p) => p.out === null))

console.log('where the viewer opens')
check('on the slot asked for', startIndex(fromIn.pairs, 'FRONT') === fromIn.pairs.findIndex((p) => p.key === 'FRONT'))
check('an unknown slot falls back to the first pair with a photo', startIndex(fromIn.pairs, 'NOPE') === fromIn.pairs.findIndex((p) => p.key === 'REAR_DRIVER_CORNER'))
check('no slot: the first pair with a photo', startIndex(fromIn.pairs, undefined) === fromIn.pairs.findIndex((p) => p.key === 'REAR_DRIVER_CORNER'))
check('nothing filed at all: 0', startIndex([], null) === 0)

if (failures.length) {
  console.error(`\n${failures.length} failed:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\nall good')
