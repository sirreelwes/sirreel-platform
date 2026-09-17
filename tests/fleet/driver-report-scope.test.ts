/**
 * What a DRIVER may see of the condition report.
 *
 *   npx tsx tests/fleet/driver-report-scope.test.ts
 *   npm run test:driver-report-scope
 *
 * Pure + offline: no DB, no env.
 *
 * Wes, 2026-09-17: "typically we deal straight with production for damage
 * reporting — do not need to send to driver after return." A driver's
 * link lives 45 days, so once fleet checks the vehicle in, the full
 * document would let the person who drove it read the return walk-around
 * and `newDamage` — which its own comment calls "what the renter is
 * actually being told about" — before the production heard it.
 *
 * `checkoutSideOnly` is the boundary. This pins that EVERY field carrying
 * the check-in is emptied, and that the check-out half is untouched. The
 * field-by-field sweep at the end is the point: a new `back`-shaped field
 * added to the report later must fail here rather than quietly reach a
 * driver.
 */

import { checkoutSideOnly, type InspectionReport, type ReportSide } from '../../src/lib/fleet/inspectionReport'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

const photo = (id: string, position: string | null) => ({ id, position, takenAt: '2026-09-16T21:14:00.000Z' })
const damage = (id: string, location: string) => ({
  id, location, damageType: 'DENT', severity: 'MODERATE', notes: null, isPreExisting: false,
})

const outSide: ReportSide = {
  inspectionId: 'out-1',
  at: '2026-09-10T15:00:00.000Z',
  inspector: 'Frankie',
  condition: 'GOOD',
  fuelLevel: 'Full',
  mileage: 41230,
  notes: 'Walked it around in the yard.',
  photos: [photo('o1', 'FRONT'), photo('o2', 'REAR')],
  damage: [damage('d-out', 'Rear bumper scuff')],
}

const backSide: ReportSide = {
  inspectionId: 'in-1',
  at: '2026-09-16T21:30:00.000Z',
  inspector: 'Andy',
  condition: 'FAIR',
  fuelLevel: 'Half',
  mileage: 41930,
  notes: 'Came back with a new dent in the driver door.',
  photos: [photo('i1', 'FRONT')],
  damage: [damage('d-in', 'Driver door dent')],
}

const full: InspectionReport = {
  assignmentId: 'asg-1',
  unitName: 'Cube 27',
  category: 'Cube Truck',
  makeModel: 'Isuzu NPR',
  licensePlate: '8ABC123',
  bookingNumber: 'B-1',
  jobName: 'Acme',
  company: 'Acme Co',
  startDate: '2026-09-10',
  endDate: '2026-09-16',
  out: outSide,
  back: backSide,
  pairs: [
    { position: 'FRONT', label: 'Front', out: photo('o1', 'FRONT'), back: photo('i1', 'FRONT') },
    { position: 'REAR', label: 'Rear', out: photo('o2', 'REAR'), back: null },
  ],
  damagePhotos: { out: [photo('o-d1', 'DAMAGE')], back: [photo('i-d1', 'DAMAGE')] },
  unpositioned: { out: [photo('o-x', null)], back: [photo('i-x', null)] },
  milesDriven: 700,
  newDamage: [damage('d-in', 'Driver door dent')],
}

const driver = checkoutSideOnly(full)

console.log('the check-in is gone')
check('no return side', driver.back === null)
check('no newDamage — the production hears that first', driver.newDamage.length === 0)
check('no check-in damage close-ups', driver.damagePhotos.back.length === 0)
check('no check-in extras', driver.unpositioned.back.length === 0)
check('every slot pair has an empty back', driver.pairs.every((p) => p.back === null))
check('no miles driven — it is derived from the return odometer', driver.milesDriven === null)

console.log('the check-out half is untouched')
check('the out side is the same object', driver.out === full.out)
check('out photos survive', driver.damagePhotos.out.length === 1 && driver.unpositioned.out.length === 1)
check('out slot photos survive', driver.pairs.every((p, i) => p.out === full.pairs[i].out))
check('pre-existing damage recorded at CHECK-OUT stays — it is what they received', (driver.out?.damage ?? []).length === 1)
check('the vehicle and booking facts stay', driver.unitName === 'Cube 27' && driver.bookingNumber === 'B-1')
check('the original is not mutated', full.back !== null && full.newDamage.length === 1)

console.log('a vehicle only ever checked IN shows the driver nothing')
{
  const backOnly = checkoutSideOnly({ ...full, out: null, pairs: full.pairs.map((p) => ({ ...p, out: null })) })
  check('out is null, so the route 404s instead of serving the return', backOnly.out === null)
  check('and the return is still stripped', backOnly.back === null && backOnly.newDamage.length === 0)
}

console.log('no check-in photo id survives anywhere')
{
  // The route fetches blob bytes for exactly the ids left in the report.
  // If one leaks through, the driver's PDF renders a check-in frame.
  const ids = [
    ...driver.pairs.flatMap((p) => [p.out, p.back]),
    ...driver.damagePhotos.out,
    ...driver.damagePhotos.back,
    ...driver.unpositioned.out,
    ...driver.unpositioned.back,
    ...(driver.back?.photos ?? []),
  ]
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => p.id)
  const checkInIds = ['i1', 'i-d1', 'i-x']
  check('no i-prefixed id reaches the render list', checkInIds.every((id) => !ids.includes(id)))
  check('the out ids do', ids.includes('o1') && ids.includes('o2'))
}

console.log('every check-in-bearing field is accounted for')
{
  // A field added to InspectionReport later that carries the return must
  // be handled here. This sweeps the shape rather than a fixed list.
  const leaked: string[] = []
  for (const [key, value] of Object.entries(driver) as [string, unknown][]) {
    const json = JSON.stringify(value ?? null)
    // Any surviving reference to the check-in inspection, its inspector,
    // its photos or its damage row is a leak.
    for (const marker of ['in-1', 'Andy', 'Driver door dent', '"i1"', '"i-d1"', '"i-x"', '41930']) {
      if (json.includes(marker)) leaked.push(`${key} still carries ${marker}`)
    }
  }
  if (leaked.length) for (const l of leaked) failures.push(l)
  check('no field carries the check-in inspection, inspector, photos, damage or odometer', leaked.length === 0)
}

if (failures.length) {
  console.error(`\n${failures.length} failed:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\nall good')
