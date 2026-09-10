/**
 * Two reservations on one job covering the same rental.
 *
 * The detector never removes anything — a production really can take two
 * identical vans, and only a person knows which case they are looking at.
 * It exists to make the pair visible, because the unit grid cannot: two
 * cards for two vans look the same either way.
 *
 * Fixtures are real jobs. The first three were the native-vs-import pairs
 * of 2026-08-26; SR-JOB-0332 is the Planyo-vs-Planyo pair of 2026-09-10
 * that the original rule could not see.
 *
 * Run: npm run test:planyo-twins
 */
import {
  findDuplicateHolds,
  findDuplicateGroups,
  isPlanyoOrigin,
  type JobBooking,
} from '@/components/jobs/JobBookingsSection'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

/** A booking the Planyo import created. */
const planyo = (
  bookingNumber: string,
  planyoCartId: string,
  startDate: string,
  endDate: string,
  category: string,
  status = 'CONFIRMED',
): JobBooking => ({
  id: bookingNumber, bookingNumber, status, startDate, endDate, planyoCartId,
  source: 'PLANYO_BACKFILL',
  items: [{ id: `${bookingNumber}-i`, category: { id: category, name: category }, assignments: [] }],
})

/** A booking entered in HQ. `cart` is set when the import ADOPTED it. */
const hq = (
  bookingNumber: string,
  startDate: string,
  endDate: string,
  category: string,
  status = 'REQUEST',
  cart: string | null = null,
): JobBooking => ({
  id: bookingNumber, bookingNumber, status, startDate, endDate, planyoCartId: cart,
  source: 'AGENT_DIRECT',
  items: [{ id: `${bookingNumber}-i`, category: { id: category, name: category }, assignments: [] }],
})

// ── Origin is Booking.source, not the cart id ──────────────────────────
eq('an import is Planyo-origin', isPlanyoOrigin(planyo('P', '1', '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate')), true)
eq('an ADOPTED native is still HQ', isPlanyoOrigin(hq('N', '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate', 'REQUEST', '5791311')), false)
eq('no source ⇒ fall back to the cart id', isPlanyoOrigin({
  id: 'X', bookingNumber: 'X', status: 'REQUEST', startDate: '2026-08-27', endDate: '2026-08-31',
  planyoCartId: '1', items: [],
}), true)

// ── SR-JOB-0219 "Holy Water" — the pair Wes spotted on the gantt ──
const holyWater = [
  hq('SR-2026-0205', '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate'),
  planyo('SR-PB-2026-6577', '5769209', '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate'),
]
let t = findDuplicateHolds(holyWater)
eq('Holy Water: native pairs to the import', t.get('SR-2026-0205')?.bookingNumber, 'SR-PB-2026-6577')
eq('Holy Water: pairing is mutual', t.get('SR-PB-2026-6577')?.bookingNumber, 'SR-2026-0205')
eq('Holy Water: one rental, one warning', findDuplicateGroups(holyWater).length, 1)

// ── SR-JOB-0217 "2632_ANAHEIM" ──
t = findDuplicateHolds([
  hq('SR-2026-0203', '2026-08-26', '2026-08-28', 'Cargo Van w/ Liftgate'),
  planyo('SR-PB-2026-8464', '5769100', '2026-08-26', '2026-08-28', 'Cargo Van w/ Liftgate'),
])
eq('2632_ANAHEIM detected', t.get('SR-2026-0203')?.bookingNumber, 'SR-PB-2026-8464')

// ── SR-JOB-0332 "Lego Playball" — TWO Planyo carts, no native at all ──
// The client booked again under a second contact, so the import raised a
// second booking beside the one it had already adopted onto HQ's row. The
// native-vs-import rule saw two "Planyo" bookings and said nothing.
const lego = [
  hq('SR-Q-1788979081484', '2026-09-11', '2026-09-16', 'SuperCube Truck', 'REQUEST', '5791311'),
  planyo('SR-PB-2026-6337', '5791845', '2026-09-11', '2026-09-16', 'SuperCube Truck'),
]
t = findDuplicateHolds(lego)
eq('Lego: the adopted native is the keeper', t.get('SR-Q-1788979081484')?.bookingNumber, 'SR-PB-2026-6337')
eq('Lego: the second cart points back at it', t.get('SR-PB-2026-6337')?.bookingNumber, 'SR-Q-1788979081484')

// Two imports with no HQ row anywhere still pair — the first is the keeper.
t = findDuplicateHolds([
  planyo('P1', '1', '2026-09-11', '2026-09-16', 'SuperCube Truck'),
  planyo('P2', '2', '2026-09-11', '2026-09-16', 'SuperCube Truck'),
])
eq('two imports pair', t.get('P1')?.bookingNumber, 'P2')
eq('two imports pair, mutually', t.get('P2')?.bookingNumber, 'P1')

// Two HQ rows for one rental pair too.
t = findDuplicateHolds([
  hq('N1', '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate'),
  hq('N2', '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate'),
])
eq('two HQ bookings pair', t.get('N1')?.bookingNumber, 'N2')

// ── SR-JOB-0063 "Hills" — TWO natives, ONE import: one rental, three holds ──
const hills = [
  hq('SR-2026-0063', '2026-07-20', '2026-07-30', 'SuperCube Truck'),
  hq('SR-2026-0064', '2026-07-20', '2026-07-30', 'SuperCube Truck'),
  planyo('SR-PB-2026-3119', '5700000', '2026-07-20', '2026-07-30', 'SuperCube Truck'),
]
t = findDuplicateHolds(hills)
eq('Hills: the first native is the keeper', t.get('SR-2026-0063')?.bookingNumber, 'SR-2026-0064')
eq('Hills: the second native points at the keeper', t.get('SR-2026-0064')?.bookingNumber, 'SR-2026-0063')
eq('Hills: so does the import', t.get('SR-PB-2026-3119')?.bookingNumber, 'SR-2026-0063')
eq('Hills: three holds, ONE warning', findDuplicateGroups(hills).length, 1)

// ── Must NOT pair ──
const nope = (label: string, rows: JobBooking[]) => eq(label, findDuplicateHolds(rows).size, 0)

nope('different dates', [
  hq('N', '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate'),
  planyo('P', '1', '2026-08-28', '2026-08-31', 'Cargo Van w/ Liftgate'),
])
nope('different equipment', [
  hq('N', '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate'),
  planyo('P', '1', '2026-08-27', '2026-08-31', 'SuperCube Truck'),
])
nope('a cancelled twin is not a duplicate', [
  hq('N', '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate'),
  planyo('P', '1', '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate', 'CANCELLED'),
])
nope('no equipment on either side', [
  { id: 'N', bookingNumber: 'N', status: 'REQUEST', startDate: '2026-08-27', endDate: '2026-08-31', planyoCartId: null, source: 'AGENT_DIRECT', items: [] },
  { id: 'P', bookingNumber: 'P', status: 'CONFIRMED', startDate: '2026-08-27', endDate: '2026-08-31', planyoCartId: '1', source: 'PLANYO_BACKFILL', items: [] },
])

// Timestamps must not defeat the date compare.
t = findDuplicateHolds([
  hq('N', '2026-08-27T00:00:00.000Z', '2026-08-31T00:00:00.000Z', 'Cargo Van w/ Liftgate'),
  planyo('P', '1', '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate'),
])
eq('ISO timestamps still pair', t.get('N')?.bookingNumber, 'P')

console.log(fail === 0 ? '\nall duplicate-hold checks passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
