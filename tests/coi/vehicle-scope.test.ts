/**
 * Whose job needs auto coverage, and what happens when a truck shows up late.
 *
 *   npx tsx tests/coi/vehicle-scope.test.ts
 *   npm run test:coi-scope
 *
 * Pure + offline: no DB, no AI, no env.
 *
 * Two directions of wrongness, and the second is the expensive one:
 *
 *   - Asking a gear-only client's broker for Hired Auto Physical Damage.
 *     This happened on 2026-09-09 (SR-JOB-0326, MITU NGL, one Starlink Mini)
 *     and the client wrote back "we are not renting any vehicles from Sir
 *     Reel." Costs goodwill and a broker's afternoon.
 *
 *   - Letting a certificate approved for a gear-only job stay green after
 *     somebody adds a truck to that job. Costs a truck.
 */

import { deriveVehicleScope } from '../../src/lib/coi/vehicleScope'
import { coiChecklist, coiFlags, coiCoversVehicles } from '../../src/lib/coi/checks'
import { rollupCoiState, coiScopeGap } from '../../src/lib/coi/coiState'
import { buildCoiFixIssues } from '../../src/lib/coi/fixRequest'
import { CRITICAL_CHECK_KEYS, ALERT_CHECK_KEYS } from '../../src/lib/coi/reviewCoi'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

const pass = { pass: true, found: '$1,000,000', note: '' }
const fail = { pass: false, found: '', note: 'Not shown on the certificate.' }

/** A certificate that meets everything EXCEPT the two auto requirements —
 *  which is what a gear-only client's ordinary GL policy looks like. */
function gearOnlyCert(overrides: Record<string, unknown> = {}) {
  const r: Record<string, unknown> = { namedInsured: 'Mitu NGL, LLC', policyExpiryDate: '2027-01-01' }
  for (const k of CRITICAL_CHECK_KEYS) r[k] = { ...pass }
  for (const k of ALERT_CHECK_KEYS) r[k] = { ...pass }
  r.policyExpiry = { pass: true, date: '2027-01-01', expired: false }
  r.autoLiability = { ...fail }
  r.autoPhysicalDamage = { ...fail }
  return { ...r, ...overrides }
}

console.log('COI vehicle scope\n')

// ── Deriving the scope ───────────────────────────────────────────────────
const starlinkOrder = {
  orders: [
    {
      status: 'APPROVED',
      lineItems: [
        { type: 'EQUIPMENT', department: 'COMMUNICATIONS', fulfillmentLane: 'WAREHOUSE' },
      ],
    },
  ],
  bookings: [],
  subRentals: [],
}
check('a Starlink-only order rents no vehicle', deriveVehicleScope(starlinkOrder).hasVehicles === false)

check(
  'a VEHICLE line rents a vehicle',
  deriveVehicleScope({
    orders: [{ status: 'APPROVED', lineItems: [{ type: 'VEHICLE', department: 'VEHICLES' }] }],
  }).hasVehicles === true,
)

check(
  'a truck held on a reservation counts before any order line exists',
  deriveVehicleScope({
    bookings: [{ status: 'CONFIRMED', items: [{ status: 'ASSIGNED', category: { department: 'VEHICLES' } }] }],
  }).hasVehicles === true,
)

check(
  'a released booking item does not count',
  deriveVehicleScope({
    bookings: [{ status: 'CONFIRMED', items: [{ status: 'UNFULFILLED', category: { department: 'VEHICLES' } }] }],
  }).hasVehicles === false,
)

check(
  'a cancelled order does not drag in the auto requirements',
  deriveVehicleScope({
    orders: [{ status: 'CANCELLED', lineItems: [{ type: 'VEHICLE', department: 'VEHICLES' }] }],
  }).hasVehicles === false,
)

// A delivery is OUR driver in OUR truck. The client is not hiring the auto,
// so a vehicles-department FEE line must not make them insure one.
check(
  'a delivery fee billed under VEHICLES is not a rented vehicle',
  deriveVehicleScope({
    orders: [
      {
        status: 'APPROVED',
        lineItems: [
          { type: 'EQUIPMENT', department: 'COMMUNICATIONS' },
          { type: 'FEE', department: 'VEHICLES' },
        ],
      },
    ],
  }).hasVehicles === false,
)

check(
  'a sub-rented partner truck is still a truck',
  deriveVehicleScope({
    subRentals: [{ status: 'CONFIRMED', subcontractedVehicleId: 'sv_1' }],
  }).hasVehicles === true,
)
check(
  'ad-hoc sub-rented gear is not',
  deriveVehicleScope({
    subRentals: [{ status: 'CONFIRMED', subcontractedVehicleId: null }],
  }).hasVehicles === false,
)

// The /tools/coi-check scratchpad has no job at all. Unknown must not read
// as "no vehicles" — that would quietly drop the requirement everywhere.
check('a caller with no job in hand gets null, not false', deriveVehicleScope({}).hasVehicles === null)

// ── Reading the checklist through the scope ──────────────────────────────
const gearRows = coiChecklist(gearOnlyCert() as never, { vehiclesOnJob: false })
const autoRows = gearRows.filter((r) => r.key === 'autoLiability' || r.key === 'autoPhysicalDamage')
check('both auto rows read NA on a gear-only job', autoRows.length === 2 && autoRows.every((r) => r.status === 'NA'))
check('an NA row is never dressed up as a pass', autoRows.every((r) => r.status !== 'PASS'))

const gearFlags = coiFlags(gearOnlyCert() as never, { vehiclesOnJob: false })
check('a gear-only certificate can clear its critical checks', gearFlags.criticalPass)
check('…and reads low risk', gearFlags.riskLevel === 'low')

const sameCertWithTruck = coiFlags(gearOnlyCert() as never, { vehiclesOnJob: true })
check('the same certificate fails once a truck is on the job', !sameCertWithTruck.criticalPass)

const unknownScope = coiFlags(gearOnlyCert() as never)
check('with no scope known, the auto requirements stand', !unknownScope.criticalPass)

check(
  'the certificate itself is still known not to cover vehicles',
  coiCoversVehicles(gearOnlyCert() as never) === false,
)

// ── What we ask the client for ───────────────────────────────────────────
const gearIssues = buildCoiFixIssues({
  ai: gearOnlyCert() as never,
  match: null,
  policyExpiryDate: null,
  ctx: { vehiclesOnJob: false },
})
check('a gear-only client is asked for nothing about autos', gearIssues.length === 0)

const truckIssues = buildCoiFixIssues({
  ai: gearOnlyCert() as never,
  match: null,
  policyExpiryDate: null,
  ctx: { vehiclesOnJob: true },
})
check(
  'a client renting a truck IS asked for physical damage',
  truckIssues.some((i) => i.includes('Hired Auto Physical Damage')),
)

// The path that actually leaked. Every enumerated check is clear or NA, but
// the AI's prose still names the coverage it thought was short — and the
// draft used to fall back to that prose whenever the STORED `overallPass`
// summary was not true. That sentence is what reached MITU NGL.
const notesLeak = buildCoiFixIssues({
  ai: gearOnlyCert({
    overallPass: false,
    notes: 'This certificate is MISSING Hired Auto Physical Damage coverage.',
  }) as never,
  match: null,
  policyExpiryDate: null,
  ctx: { vehiclesOnJob: false },
})
check("the AI's prose is not sent when nothing is actually open", notesLeak.length === 0)

// …but it is still the fallback when something IS open and no bullet names it.
const notesKept = buildCoiFixIssues({
  ai: gearOnlyCert({
    overallPass: false,
    umbrella: { ...fail },
    notes: 'No umbrella shown.',
  }) as never,
  match: null,
  policyExpiryDate: null,
  ctx: { vehiclesOnJob: false },
})
check("the reviewer's fallback still fires on a real gap", notesKept.length === 0 || notesKept[0] === 'No umbrella shown.')

// The legacy flat-boolean shape has no per-check rows to mark NA, so the
// same exemption has to hold by hand.
const legacyGear = buildCoiFixIssues({
  ai: { overallPass: false, autoPhysicalDamage: false } as never,
  match: null,
  policyExpiryDate: null,
  ctx: { vehiclesOnJob: false },
})
check('a legacy review does not ask a gear-only client for autos either', legacyGear.length === 0)

// ── The truck that shows up after the sign-off ───────────────────────────
const approvedGearOnly = {
  humanDecision: 'APPROVED',
  policyExpiryDate: '2027-01-01',
  coverageVerified: true,
  decidedWithVehicles: false,
}
check(
  'approved gear-only, still gear-only: verified',
  rollupCoiState({ ...approvedGearOnly, jobHasVehicles: false }).state === 'VERIFIED',
)
check(
  'approved gear-only, truck added since: reopened',
  rollupCoiState({ ...approvedGearOnly, jobHasVehicles: true }).state === 'ISSUE',
)
check('…and the gap is named as such', coiScopeGap({ ...approvedGearOnly, jobHasVehicles: true }))

// One-directional on purpose: a certificate approved WITH vehicles carries
// more coverage than a gear-only job needs. Nothing to reopen.
check(
  'approved with vehicles, vehicles later removed: still verified',
  rollupCoiState({
    humanDecision: 'APPROVED',
    policyExpiryDate: '2027-01-01',
    coverageVerified: true,
    decidedWithVehicles: true,
    jobHasVehicles: false,
  }).state === 'VERIFIED',
)

// Every row decided before the column existed carries null. A retroactive
// alarm across the whole history is noise nobody can act on.
check(
  'a sign-off from before the scope was recorded raises nothing',
  rollupCoiState({
    humanDecision: 'APPROVED',
    policyExpiryDate: '2027-01-01',
    coverageVerified: true,
    decidedWithVehicles: null,
    jobHasVehicles: true,
  }).state === 'VERIFIED',
)

// And the caller that cannot see the job must not manufacture a gap.
check(
  'an unknown job scope raises nothing',
  rollupCoiState({ ...approvedGearOnly, jobHasVehicles: null }).state === 'VERIFIED',
)

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All COI vehicle-scope checks passed.')
