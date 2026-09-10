/**
 * Who pays the driver on a partner vehicle.
 *
 * Wes 2026-09-09: "sometimes we will bill for the Driver on our invoice and
 * pass that along to them, but there are also times when it is a union job and
 * the driver will be on the payroll of the Production company."
 *
 * Two things decide whether a driver charge reaches a client:
 *   1. `isDriverLaborFee` — which row IS the driver, on a fee schedule the
 *      partner writes in free text.
 *   2. `buildFeeLines(..., { excludeDriverLabor })` — dropping exactly that
 *      row and nothing else.
 *
 * Both failure directions are asserted because both cost real money and
 * neither is visible on the quote that goes out:
 *   · FALSE NEGATIVE — we bill a union production $550/day for a driver they
 *     are already carrying on their own payroll. That is the invoice dispute
 *     this feature exists to prevent.
 *   · FALSE POSITIVE — a non-driver row (or a driver row on a NON-union job)
 *     is silently dropped, and a real day's charge leaves the quote with
 *     nothing on screen to say so. That is S260828-001 again.
 *
 * Run: npm run test:driver-payroll
 */
import { Prisma } from '@prisma/client'
import { isDriverLaborFee } from '@/lib/sub-rentals/vehicles'
import { buildFeeLines, type PartnerFee } from '@/lib/sub-rentals/orderFees'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = got === want
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

// ── 1. Which row is the driver ────────────────────────────────────────────
// The live King Kong schedule, as the model comment records it.
eq('"Driver" reads as driver labor', isDriverLaborFee({ label: 'Driver' }), true)
eq('"Driver (10 hr day)" too', isDriverLaborFee({ label: 'Driver (10 hr day)' }), true)
eq('"Teamster driver" too', isDriverLaborFee({ label: 'Teamster driver' }), true)
eq('Mileage is not', isDriverLaborFee({ label: 'Mileage' }), false)
eq('Generator usage is not', isDriverLaborFee({ label: 'Generator usage' }), false)
eq('Supplies is not', isDriverLaborFee({ label: 'Supplies' }), false)
// "Screwdriver" contains "driver" but is not the word — the \b anchors hold.
eq('Screwdrivers are not driver labor', isDriverLaborFee({ label: 'Screwdrivers' }), false)

// An explicit answer overrules the label in BOTH directions. This is the only
// repair available when a partner names the row something the regex misses.
eq('explicit true beats an unlike label', isDriverLaborFee({ label: 'Wheelman', isDriverLabor: true }), true)
eq('explicit false beats a driver-ish label', isDriverLaborFee({ label: 'Driver’s room', isDriverLabor: false }), false)
// null is NOT false — the state every pre-existing row is in.
eq('null falls back to the label', isDriverLaborFee({ label: 'Driver', isDriverLabor: null }), true)

// ── 2. What lands on the order ────────────────────────────────────────────
const fee = (over: Partial<PartnerFee>): PartnerFee => ({
  id: over.label ?? 'f', label: 'Fee', amount: '100.00', unit: 'PER_DAY',
  coversHours: null, unionScope: 'ALL', metered: false, usageNoun: 'units',
  driverLabor: false, ...over,
})

const SCHEDULE: PartnerFee[] = [
  fee({ id: 'driver', label: 'Driver', amount: '550.00', unit: 'PER_DAY', coversHours: '10', unionScope: 'NON_UNION', driverLabor: true }),
  fee({ id: 'supplies', label: 'Supplies', amount: '35.00', unit: 'PER_DAY' }),
  fee({ id: 'mileage', label: 'Mileage', amount: '2.95', unit: 'PER_MILE', metered: true, usageNoun: 'miles' }),
]
const ESTIMATES = { mileage: 120 }
const DAYS = 3

const billed = buildFeeLines(SCHEDULE, ESTIMATES, DAYS, Prisma.Decimal)
const payroll = buildFeeLines(SCHEDULE, ESTIMATES, DAYS, Prisma.Decimal, { excludeDriverLabor: true })
const total = (ls: { lineTotal: Prisma.Decimal }[]) => ls.reduce((n, l) => n + Number(l.lineTotal), 0)

// We bill the driver: nothing changed from before this feature existed.
eq('billed → 3 lines', billed.length, 3)
eq('billed → driver line present', billed.some((l) => /Driver/.test(l.description)), true)
eq('billed → $550 × 3 days', Number(billed.find((l) => /Driver/.test(l.description))!.lineTotal), 1650)
eq('billed → total', total(billed), 1650 + 105 + 354)

// Production payroll: the driver line is GONE, not zeroed. A $0 line on a
// quote reads as "driver included", which is a promise we have not made.
eq('payroll → 2 lines', payroll.length, 2)
eq('payroll → no driver line', payroll.some((l) => /Driver/.test(l.description)), false)
eq('payroll → no $0 line either', payroll.some((l) => Number(l.lineTotal) === 0), false)

// …and nothing ELSE moved. The production pays the driver, not the fuel.
eq('payroll → supplies survive at full price', total(payroll.filter((l) => /Supplies/.test(l.description))), 105)
eq('payroll → mileage survives at full price', total(payroll.filter((l) => /Mileage/.test(l.description))), 354)
eq('payroll → total is exactly the driver less', total(billed) - total(payroll), 1650)

// A schedule with no driver row is untouched by the switch — a restroom
// trailer that gets delivered has nothing to drop.
const noDriver = SCHEDULE.filter((f) => !f.driverLabor)
eq(
  'no driver row → the switch is a no-op',
  total(buildFeeLines(noDriver, ESTIMATES, DAYS, Prisma.Decimal, { excludeDriverLabor: true })),
  total(buildFeeLines(noDriver, ESTIMATES, DAYS, Prisma.Decimal)),
)

console.log(fail === 0 ? '\nAll driver-payroll checks passed.' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
