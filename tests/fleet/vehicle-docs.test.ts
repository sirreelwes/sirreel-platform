/**
 * The two client-facing DOT documents on a unit — registration and the
 * current BIT certificate (2026-09-17).
 *
 *   npx tsx tests/fleet/vehicle-docs.test.ts
 *   npm run test:vehicle-docs
 *
 * Pure + offline: no DB, no blob, no env.
 *
 * Pins the three rules that are load-bearing and easy to get backwards:
 * the BIT pointer moves only for the NEWEST inspection (a backfill must not
 * publish last cycle's certificate); the expiry chip agrees with the cron's
 * 30-day horizon; and the portal narrowing — which is a SECURITY check now
 * that the document proxy takes an assetId off the query string — never
 * hands a client a sibling order's unit.
 */

import {
  DOC_EXPIRY_HORIZON_DAYS,
  VEHICLE_DOC_KINDS,
  VEHICLE_DOC_LABEL,
  docExpiryState,
  inspectionRegimeForClass,
  isUploadableKind,
  narrowAssignmentsToOrder,
  parseVehicleDocKind,
  portalDocHref,
  shouldStampCurrentBit,
  vehicleDocFilename,
  vehicleDocLabel,
  vehicleDocShortLabel,
} from '../../src/lib/fleet/vehicleDocs'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

const now = new Date('2026-09-17T12:00:00Z')
const daysOut = (n: number) => new Date(now.getTime() + n * 86_400_000)

console.log('kinds')
check('both kinds parse', parseVehicleDocKind('registration') === 'registration' && parseVehicleDocKind('bit-certificate') === 'bit-certificate')
check('case and padding are tolerated', parseVehicleDocKind('  Registration ') === 'registration')
check('anything else is null, never a throw', parseVehicleDocKind('insurance') === null && parseVehicleDocKind(undefined) === null && parseVehicleDocKind(7) === null)
check('every kind has a label', VEHICLE_DOC_KINDS.every((k) => !!VEHICLE_DOC_LABEL[k]))
check('only the registration is uploadable', isUploadableKind('registration') && !isUploadableKind('bit-certificate'))

console.log('\nexpiry state')
check('no file at all', docExpiryState({ hasFile: false, expiresAt: daysOut(90) }, now) === 'missing')
check('filed with no expiry is not an alarm', docExpiryState({ hasFile: true, expiresAt: null }, now) === 'no-expiry')
check('an unparseable date reads as no expiry, not as expired', docExpiryState({ hasFile: true, expiresAt: 'soon' }, now) === 'no-expiry')
check('well in the future is ok', docExpiryState({ hasFile: true, expiresAt: daysOut(90) }, now) === 'ok')
check('inside the cron horizon is expiring', docExpiryState({ hasFile: true, expiresAt: daysOut(10) }, now) === 'expiring')
check('past is expired', docExpiryState({ hasFile: true, expiresAt: daysOut(-1) }, now) === 'expired')
check('today is expired, not expiring', docExpiryState({ hasFile: true, expiresAt: now }, now) === 'expired')
// The chip and the cron must agree: one day inside the horizon is amber,
// one day outside is not, or a unit wears a warning on a day nobody was told.
check(
  `the boundary is the cron's ${DOC_EXPIRY_HORIZON_DAYS} days`,
  docExpiryState({ hasFile: true, expiresAt: daysOut(DOC_EXPIRY_HORIZON_DAYS - 1) }, now) === 'expiring' &&
    docExpiryState({ hasFile: true, expiresAt: daysOut(DOC_EXPIRY_HORIZON_DAYS + 1) }, now) === 'ok',
)
check('a string date reads the same as a Date', docExpiryState({ hasFile: true, expiresAt: '2026-12-31' }, now) === 'ok')

console.log('\nwhich BIT inspection becomes the current certificate')
const sep = new Date('2026-09-01T00:00:00Z')
const mar = new Date('2026-03-01T00:00:00Z')
check('the first one ever filed', shouldStampCurrentBit({ newInspectionDate: mar, latestExistingDate: null }))
check('a newer one takes over', shouldStampCurrentBit({ newInspectionDate: sep, latestExistingDate: mar }))
check(
  'BACKFILLING AN OLDER ONE DOES NOT — the client keeps seeing the current cert',
  !shouldStampCurrentBit({ newInspectionDate: mar, latestExistingDate: sep }),
)
check(
  're-scanning the same day wins — a correction is what should be served',
  shouldStampCurrentBit({ newInspectionDate: sep, latestExistingDate: new Date('2026-09-01T00:00:00Z') }),
)

console.log('\nwhich units a portal session may read')
const A = 'order-A'
const B = 'order-B'
const rows = [
  { orderId: A, assetId: 'van-1' },
  { orderId: B, assetId: 'cube-9' },
  { orderId: null, assetId: 'legacy-1' },
]
const mine = narrowAssignmentsToOrder(rows, [A, undefined])
check("this order's stamped units only", mine.length === 1 && mine[0].assetId === 'van-1')
check(
  "a SIBLING order's truck is never in reach (the 2026-09-15 leak)",
  !narrowAssignmentsToOrder(rows, [A, undefined]).some((r) => r.assetId === 'cube-9'),
)
check(
  'with nothing stamped to this order, the unstamped legacy rows are the list',
  narrowAssignmentsToOrder(rows, ['order-C', undefined]).map((r) => r.assetId).join() === 'legacy-1',
)
check(
  'the order we followed off counts as ours',
  narrowAssignmentsToOrder(rows, ['order-C', B]).map((r) => r.assetId).join() === 'cube-9',
)
check('no assignments at all is empty, not everything', narrowAssignmentsToOrder([], [A]).length === 0)
check(
  'a session with no order ids reaches only the unstamped rows',
  narrowAssignmentsToOrder(rows, [null, undefined]).map((r) => r.assetId).join() === 'legacy-1',
)

console.log('\nhrefs and filenames')
check(
  'the portal href carries the proxy, never a blob URL',
  portalDocHref('asset-1', 'registration') === '/api/portal/job/vehicle-doc?assetId=asset-1&kind=registration',
)
check('an odd asset id is encoded', portalDocHref('a/b', 'bit-certificate').includes('assetId=a%2Fb'))
check(
  'a saved copy names the unit, the document and the expiry',
  vehicleDocFilename({ unitName: 'Cube 27', kind: 'registration', expiresAt: '2027-04-30' }) === 'Cube-27_registration_exp-2027-04-30.pdf',
)
check(
  'no expiry, no expiry segment',
  vehicleDocFilename({ unitName: 'Cargo 22', kind: 'bit-certificate', expiresAt: null }) === 'Cargo-22_DOT-inspection.pdf',
)
// Julian 2026-09-18: the trucks carry a DOT ANNUAL inspection and the vans a
// CHP BIT, so "BIT" was the wrong word on most of the fleet. The label is
// what changed; the kind KEY stays, because it is a wire value in the portal
// proxy's URL and half a column name.
check('the label is what people call it', VEHICLE_DOC_LABEL['bit-certificate'] === 'DOT inspection')
check('the wire value is unchanged', parseVehicleDocKind('bit-certificate') === 'bit-certificate')
check(
  'an unparseable expiry is dropped rather than written as Invalid Date',
  vehicleDocFilename({ unitName: 'Cube 27', kind: 'registration', expiresAt: 'nope' }) === 'Cube-27_registration.pdf',
)

// ── Which inspection a class carries ──────────────────────────────────────
// Julian 2026-09-18: a truck's is the federal DOT annual, a passenger van's
// is the CHP BIT. That day the word swung to "DOT inspection" on the WHOLE
// fleet, and Wes 2026-09-19 asked the obvious question back — "where is the
// BIT Inspections? For pass vans that is what is needed." Both directions
// are expensive: "BIT" on a cube is wrong to an inspector, and a van whose
// screen will only say "DOT" is a screen Julian cannot find his BIT on.
console.log('\ninspection regime')
check('a passenger van owes the CHP BIT', inspectionRegimeForClass('Passenger Van') === 'bit')
// The family was renamed under us once already (the 2026-09-09 split), which
// is why this is a pattern and not a list of exact category names.
check(
  'both halves of the 12-/15- split too',
  inspectionRegimeForClass('12-Passenger Van') === 'bit' && inspectionRegimeForClass('15-Passenger Van') === 'bit',
)
check('case does not matter', inspectionRegimeForClass('passenger van') === 'bit')
// The discriminator is the word "passenger". Every one of these also ends in
// "Van" or is a van-shaped thing, so a looser match would have swept them in
// and put BIT on a cube — the exact error 2026-09-18 was fixing.
check(
  'a cargo van is NOT a passenger van',
  inspectionRegimeForClass('Cargo Van w/ Liftgate') === 'dot' && inspectionRegimeForClass('Cargo Van w/o Liftgate') === 'dot',
)
check(
  'nor is anything else on the roster',
  ['SuperCube Truck', 'Cube Truck', 'PopVan', 'Camera Cube', 'Stakebed', 'DLUX', 'Scissor Lift', 'ProScout / VTR']
    .every((c) => inspectionRegimeForClass(c) === 'dot'),
)
// An unknown class gets the umbrella, which is correct-but-vague, rather
// than a guess that is confidently wrong on a document handed to the CHP.
check(
  'an unknown or absent class falls back to the umbrella',
  inspectionRegimeForClass(null) === 'dot' && inspectionRegimeForClass(undefined) === 'dot' && inspectionRegimeForClass('') === 'dot',
)

console.log('\nlabels')
check('a van reads BIT', vehicleDocLabel('bit-certificate', '15-Passenger Van') === 'BIT inspection')
check('a cube reads DOT', vehicleDocLabel('bit-certificate', 'SuperCube Truck') === 'DOT inspection')
check('the registration is the registration on both', vehicleDocLabel('registration', '15-Passenger Van') === 'Registration')
check(
  'the chip form is the bare acronym',
  vehicleDocShortLabel('bit-certificate', 'Passenger Van') === 'BIT' &&
    vehicleDocShortLabel('bit-certificate', 'Cube Truck') === 'DOT' &&
    vehicleDocShortLabel('registration', 'Passenger Van') === 'Reg',
)
// The constant map is what every caller WITHOUT a class in hand reads, so it
// and the function must not be able to disagree.
check(
  'the class-free map is the same answer as a class-free call',
  VEHICLE_DOC_LABEL['bit-certificate'] === vehicleDocLabel('bit-certificate', null),
)
check(
  "a van's saved copy is filed under BIT",
  vehicleDocFilename({ unitName: 'Pass 3', kind: 'bit-certificate', expiresAt: '2027-06-30', categoryName: '15-Passenger Van' }) ===
    'Pass-3_BIT-inspection_exp-2027-06-30.pdf',
)
check(
  'and an unclassed one keeps the name it always had',
  vehicleDocFilename({ unitName: 'Cargo 22', kind: 'bit-certificate', expiresAt: null }) === 'Cargo-22_DOT-inspection.pdf',
)

if (failures.length) {
  console.error(`\n${failures.length} failed:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\nall good')
