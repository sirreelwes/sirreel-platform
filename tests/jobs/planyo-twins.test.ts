/**
 * Pairing a native reservation with the Planyo import of the same rental.
 *
 * The importer keys idempotency on planyoCartId, which a native booking does
 * not have, so it cannot see its own twin and creates a second booking on the
 * same job. This is the detector that surfaces the pair to a human — it never
 * removes anything, because a production really can take two identical vans
 * and only a person knows which case they are looking at.
 *
 * Fixtures are the three real jobs that were in this state on 2026-08-26.
 *
 * Run: npm run test:planyo-twins
 */
import { findPlanyoTwins, type JobBooking } from '@/components/jobs/JobBookingsSection'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

const bk = (
  bookingNumber: string,
  planyoCartId: string | null,
  startDate: string,
  endDate: string,
  category: string,
  status = 'REQUEST',
): JobBooking => ({
  id: bookingNumber, bookingNumber, status, startDate, endDate, planyoCartId,
  items: [{ id: `${bookingNumber}-i`, category: { id: category, name: category }, assignments: [] }],
})

// ── SR-JOB-0219 "Holy Water" — the pair Wes spotted on the gantt ──
const holyWater = [
  bk('SR-2026-0205', null, '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate'),
  bk('SR-PB-2026-6577', '5769209', '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate', 'CONFIRMED'),
]
let t = findPlanyoTwins(holyWater)
eq('Holy Water: native pairs to the import', t.get('SR-2026-0205')?.bookingNumber, 'SR-PB-2026-6577')
eq('Holy Water: pairing is mutual', t.get('SR-PB-2026-6577')?.bookingNumber, 'SR-2026-0205')

// ── SR-JOB-0217 "2632_ANAHEIM" ──
t = findPlanyoTwins([
  bk('SR-2026-0203', null, '2026-08-26', '2026-08-28', 'Cargo Van w/ Liftgate'),
  bk('SR-PB-2026-8464', '5769100', '2026-08-26', '2026-08-28', 'Cargo Van w/ Liftgate', 'CONFIRMED'),
])
eq('2632_ANAHEIM detected', t.get('SR-2026-0203')?.bookingNumber, 'SR-PB-2026-8464')

// ── SR-JOB-0063 "Hills" — TWO natives, ONE import. Only one may claim it. ──
t = findPlanyoTwins([
  bk('SR-2026-0063', null, '2026-07-20', '2026-07-30', 'SuperCube Truck'),
  bk('SR-2026-0064', null, '2026-07-20', '2026-07-30', 'SuperCube Truck'),
  bk('SR-PB-2026-3119', '5700000', '2026-07-20', '2026-07-30', 'SuperCube Truck', 'CONFIRMED'),
])
eq('Hills: first native claims the import', t.get('SR-2026-0063')?.bookingNumber, 'SR-PB-2026-3119')
eq('Hills: second native is NOT paired to the same import', t.get('SR-2026-0064'), undefined)

// ── Must NOT pair ──
const nope = (label: string, rows: JobBooking[]) =>
  eq(label, findPlanyoTwins(rows).size, 0)

nope('different dates', [
  bk('N', null, '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate'),
  bk('P', '1', '2026-08-28', '2026-08-31', 'Cargo Van w/ Liftgate'),
])
nope('different equipment', [
  bk('N', null, '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate'),
  bk('P', '1', '2026-08-27', '2026-08-31', 'SuperCube Truck'),
])
nope('two natives, no import', [
  bk('N1', null, '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate'),
  bk('N2', null, '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate'),
])
nope('two imports, no native', [
  bk('P1', '1', '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate'),
  bk('P2', '2', '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate'),
])
nope('a cancelled twin is not a duplicate', [
  bk('N', null, '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate'),
  bk('P', '1', '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate', 'CANCELLED'),
])
nope('no equipment on either side', [
  { id: 'N', bookingNumber: 'N', status: 'REQUEST', startDate: '2026-08-27', endDate: '2026-08-31', planyoCartId: null, items: [] },
  { id: 'P', bookingNumber: 'P', status: 'CONFIRMED', startDate: '2026-08-27', endDate: '2026-08-31', planyoCartId: '1', items: [] },
])

// Timestamps must not defeat the date compare.
t = findPlanyoTwins([
  bk('N', null, '2026-08-27T00:00:00.000Z', '2026-08-31T00:00:00.000Z', 'Cargo Van w/ Liftgate'),
  bk('P', '1', '2026-08-27', '2026-08-31', 'Cargo Van w/ Liftgate', 'CONFIRMED'),
])
eq('ISO timestamps still pair', t.get('N')?.bookingNumber, 'P')

console.log(fail === 0 ? '\nall planyo-twin checks passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
