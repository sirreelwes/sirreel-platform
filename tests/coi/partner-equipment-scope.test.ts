/**
 * A partner's equipment on the job makes the equipment floater CRITICAL.
 *
 *   npx tsx tests/coi/partner-equipment-scope.test.ts
 *   npm run test:partner-equipment-scope
 *
 * Pure + offline: no DB, no session.
 *
 * The sibling of tests/coi/vehicle-scope.test.ts, and the mirror image of it.
 * vehicleScope RELAXES the checklist when the job has no truck; this one
 * TIGHTENS it when the job carries a partner's unit — because Partner
 * Equipment Agreement §4 tells the partner, in writing, that the production's
 * rented-equipment coverage reaches their generator, and §5 leaves SirReel
 * paying the generator's actual cash value when it doesn't.
 *
 * Both failure directions cost something real and they are not symmetric:
 *   - failing to promote → a partner's unit ships on a certificate with no
 *     equipment floater, and SirReel is the only thing behind it
 *   - promoting when it shouldn't → a client's broker is chased for an
 *     endorsement nobody needed, which is the exact goodwill vehicleScope was
 *     written to stop spending
 * The second is recoverable, so UNKNOWN must never promote.
 */

import { coiChecklist, coiFlags } from '../../src/lib/coi/checks'
import { derivePartnerEquipmentScope } from '../../src/lib/coi/partnerEquipmentScope'
import { deriveCoiScope } from '../../src/lib/coi/jobScope'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  if (JSON.stringify(got) === JSON.stringify(want)) console.log(`  ok — ${why}`)
  else failures.push(`${why}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}

const EQUIP = (name = 'PowerTrip Rentals') => ({ partnerKind: 'EQUIPMENT', name })
const VEHIC = (name = 'King Kong Production Vehicles') => ({ partnerKind: 'VEHICLES', name })

// ── The deriver ──────────────────────────────────────────────────────
console.log('\nWhat counts as partner equipment on a job\n')

eq(derivePartnerEquipmentScope({}).hasPartnerEquipment, null, 'a caller that loaded nothing gets UNKNOWN, not false')
eq(derivePartnerEquipmentScope({ subRentals: null }).hasPartnerEquipment, null, 'explicit null is still UNKNOWN')
eq(derivePartnerEquipmentScope({ subRentals: [] }).hasPartnerEquipment, false, 'an empty list is a real, answerable no')

eq(
  derivePartnerEquipmentScope({ subRentals: [{ status: 'CONFIRMED', vendor: EQUIP() }] }).hasPartnerEquipment,
  true,
  'an EQUIPMENT partner on the job promotes',
)
eq(
  derivePartnerEquipmentScope({ subRentals: [{ status: 'CONFIRMED', vendor: VEHIC() }] }).hasPartnerEquipment,
  false,
  'a VEHICLES partner does NOT — the auto checks already cover their truck',
)
eq(
  derivePartnerEquipmentScope({ subRentals: [{ status: 'CANCELLED', vendor: EQUIP() }] }).hasPartnerEquipment,
  false,
  'a cancelled sub-rental is not going out',
)
eq(
  derivePartnerEquipmentScope({
    subRentals: [{ status: 'CANCELLED', vendor: EQUIP() }, { status: 'ESTIMATED', vendor: EQUIP() }],
  }).hasPartnerEquipment,
  true,
  'a live row beside a cancelled one still promotes',
)
eq(
  derivePartnerEquipmentScope({ subRentals: [{ status: 'CONFIRMED', vendor: null }] }).hasPartnerEquipment,
  false,
  'a sub-rental with no vendor loaded is not assumed to be equipment',
)
eq(
  derivePartnerEquipmentScope({
    subRentals: [{ status: 'CONFIRMED', vendor: EQUIP() }, { status: 'ON_RENT', vendor: EQUIP() }],
  }).reasons.length,
  1,
  'the same partner twice is one reason, not two',
)

// ── The tiering ──────────────────────────────────────────────────────
console.log('\nThe effect on the checklist\n')

const failingFloater = {
  certificateHolder: { pass: true },
  entertainmentPackage: { pass: false, found: 'not shown', note: 'No equipment floater listed.' },
} as never
const row = (ctx?: Parameters<typeof coiChecklist>[1]) =>
  coiChecklist(failingFloater, ctx).find((r) => r.key === 'entertainmentPackage')

eq(row()?.tier, 'ALERT', 'with no context it stays where it has always been')
eq(row({ partnerEquipmentOnJob: false })?.tier, 'ALERT', 'a job with no partner equipment leaves it an alert')
eq(row({ partnerEquipmentOnJob: null })?.tier, 'ALERT', 'UNKNOWN never hardens the check')
eq(row({ partnerEquipmentOnJob: true })?.tier, 'CRITICAL', 'a partner unit promotes it')

eq(row({ partnerEquipmentOnJob: true })?.status, 'FAIL', 'the tier moves; the stored verdict does not')
eq(
  coiChecklist({ ...(failingFloater as object), entertainmentPackage: { pass: true } } as never, {
    partnerEquipmentOnJob: true,
  }).find((r) => r.key === 'entertainmentPackage')?.status,
  'PASS',
  'a passing floater still passes once promoted',
)
eq(
  row({ partnerEquipmentOnJob: true, partnerEquipmentNote: 'PowerTrip Rentals equipment sub-rented onto this job' })
    ?.note?.includes('PowerTrip Rentals'),
  true,
  'the note names whose equipment made it critical, rather than asserting it',
)

// A tier nothing reads is decoration — it has to reach the rollup.
eq(
  coiFlags(failingFloater, { partnerEquipmentOnJob: true }).criticalOpen.some((r) => r.key === 'entertainmentPackage'),
  true,
  'the promoted row counts as a CRITICAL gap',
)
eq(
  coiFlags(failingFloater, { partnerEquipmentOnJob: false }).alertOpen.some((r) => r.key === 'entertainmentPackage'),
  true,
  'and as an ALERT gap when it is not promoted',
)

// ── The composed gather ──────────────────────────────────────────────
console.log('\nBoth scopings from one load\n')

const gearOnlyWithPartnerGen = deriveCoiScope({
  orders: [],
  bookings: [],
  subRentals: [{ status: 'CONFIRMED', subcontractedVehicleId: null, vendor: EQUIP() }],
})
eq(gearOnlyWithPartnerGen.hasVehicles, false, 'a partner GENERATOR does not make the job a vehicle job')
eq(gearOnlyWithPartnerGen.hasPartnerEquipment, true, 'but it does promote the floater')
eq(gearOnlyWithPartnerGen.ctx.vehiclesOnJob, false, 'and both verdicts reach the ctx')
eq(gearOnlyWithPartnerGen.ctx.partnerEquipmentOnJob, true, 'from a single load')

const partnerTruck = deriveCoiScope({
  orders: [],
  bookings: [],
  subRentals: [{ status: 'CONFIRMED', subcontractedVehicleId: 'sv-1', vendor: VEHIC() }],
})
eq(partnerTruck.hasVehicles, true, "a partner's TRUCK is still a truck the client drives away")
eq(partnerTruck.hasPartnerEquipment, false, 'and is covered by the auto checks, not the floater')

if (failures.length) {
  console.error(`\n${failures.length} FAILED:`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\nAll checks passed.')
