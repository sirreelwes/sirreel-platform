/**
 * Date convention test — Planyo↔HQ LA-canonical converter.
 * Pure logic, no DB, no network.
 *
 *   npx tsx tests/sync/planyo/dateConvention.test.ts
 *
 * The 12 known off-by-one end-lines (from the May 2026 backfill) must
 * show ZERO drift after conversion. If this fails, the sync writes are
 * unsafe — do not run.
 */

import {
  planyoLocalTimeToLADate,
  hqStoredToLADate,
  readHQDateLA,
  laDateStartToUTC,
  laDateEndToUTC,
} from '../../../src/lib/sync/planyo/dateConvention'

const failures: string[] = []
function eq(actual: unknown, expected: unknown, label: string): void {
  if (actual === expected) console.log(`  ok — ${label}`)
  else failures.push(`${label}\n    got:      ${JSON.stringify(actual)}\n    expected: ${JSON.stringify(expected)}`)
}

console.log('Planyo local-time string → LA date')
eq(planyoLocalTimeToLADate('2026-06-16 23:59:00'), '2026-06-16', 'end string')
eq(planyoLocalTimeToLADate('2026-06-17 00:00:00'), '2026-06-17', 'start string')
eq(planyoLocalTimeToLADate(null), null, 'null safety')

console.log('\nHQ stored UTC → LA date')
// HQ correctly-stored end: 23:59 PDT = 06:59 UTC next day
eq(hqStoredToLADate(new Date('2026-06-17T06:59:00.000Z')), '2026-06-16', 'PDT end (correct storage)')
// HQ correctly-stored start: 00:00 PDT = 07:00 UTC same day
eq(hqStoredToLADate(new Date('2026-06-17T07:00:00.000Z')), '2026-06-17', 'PDT start (correct storage)')
// PST equivalent
eq(hqStoredToLADate(new Date('2026-01-10T07:59:00.000Z')), '2026-01-09', 'PST end (correct storage)')

console.log('\nLA date → UTC Date (round-trip)')
const utc1 = laDateStartToUTC('2026-06-17')
eq(utc1.toISOString(), '2026-06-17T07:00:00.000Z', 'PDT start → 07:00 UTC')
const utc2 = laDateEndToUTC('2026-06-16')
eq(utc2.toISOString(), '2026-06-17T06:59:00.000Z', 'PDT end (LA 6/16 23:59) → 6/17 06:59 UTC')
const utc3 = laDateStartToUTC('2026-01-10')
eq(utc3.toISOString(), '2026-01-10T08:00:00.000Z', 'PST start → 08:00 UTC')
const utc4 = laDateEndToUTC('2026-01-10')
eq(utc4.toISOString(), '2026-01-11T07:59:00.000Z', 'PST end (LA 1/10 23:59) → 1/11 07:59 UTC')

console.log('\n12 known off-by-one end lines → ZERO drift after LA conversion')
const pairs: Array<{ rid: string; planyoEnd: string; hqEndUTC: string }> = [
  { rid: '19504166', planyoEnd: '2026-06-16 23:59:00', hqEndUTC: '2026-06-17T06:59:00.000Z' },
  { rid: '19483452', planyoEnd: '2026-06-23 23:59:00', hqEndUTC: '2026-06-24T06:59:00.000Z' },
  { rid: '19542924', planyoEnd: '2026-06-15 23:59:00', hqEndUTC: '2026-06-16T06:59:00.000Z' },
  { rid: '19544178', planyoEnd: '2026-07-16 23:59:00', hqEndUTC: '2026-07-17T06:59:00.000Z' },
  { rid: '19459009', planyoEnd: '2026-06-27 23:59:00', hqEndUTC: '2026-06-28T06:59:00.000Z' },
  { rid: '19572060', planyoEnd: '2026-07-08 23:59:00', hqEndUTC: '2026-07-09T06:59:00.000Z' },
  { rid: '19532063', planyoEnd: '2026-06-19 23:59:00', hqEndUTC: '2026-06-20T06:59:00.000Z' },
  { rid: '19532070', planyoEnd: '2026-06-19 23:59:00', hqEndUTC: '2026-06-20T06:59:00.000Z' },
  { rid: '19537931', planyoEnd: '2026-06-18 23:59:00', hqEndUTC: '2026-06-19T06:59:00.000Z' },
  { rid: '19392624', planyoEnd: '2026-07-31 23:59:00', hqEndUTC: '2026-08-01T06:59:00.000Z' },
  { rid: '19458724', planyoEnd: '2026-07-16 23:59:00', hqEndUTC: '2026-07-17T06:59:00.000Z' },
  { rid: '19458736', planyoEnd: '2026-07-16 23:59:00', hqEndUTC: '2026-07-17T06:59:00.000Z' },
]
for (const p of pairs) {
  const planyoLA = planyoLocalTimeToLADate(p.planyoEnd)
  const hqLA = hqStoredToLADate(new Date(p.hqEndUTC))
  eq(hqLA, planyoLA, `resv=${p.rid}  Planyo→LA=${planyoLA}  HQ→LA=${hqLA}`)
}

console.log('\nConvention-aware reader — discriminates A vs B per row')
// Convention A — LA-canonical UTC. LA-render correct; UTC-component wrong by 1 day on end.
eq(readHQDateLA(new Date('2026-06-17T07:00:00.000Z')), '2026-06-17', 'A start (07:00 UTC = LA 6/17 midnight) → 6/17')
eq(readHQDateLA(new Date('2026-06-17T06:59:00.000Z')), '2026-06-16', 'A end (06:59 UTC = LA 6/16 23:59) → 6/16')
// Convention B — UTC-midnight encoding (May backfill bug). UTC components correct.
eq(readHQDateLA(new Date('2026-06-17T00:00:00.000Z')), '2026-06-17', 'B start (00:00 UTC = stored LA date 6/17) → 6/17')
eq(readHQDateLA(new Date('2026-06-17T23:59:00.000Z')), '2026-06-17', 'B end (23:59 UTC = LA 6/17 16:59) → 6/17')

console.log('\nRegression — every real ±1-day drift is caught (no holes)')
// 1) Convention-B row, Planyo +1 day → reader gives 6/17, drift to 6/18 must be UPDATE_DATES.
{
  const hqStart = new Date('2026-06-17T00:00:00.000Z') // Convention B
  const planyoStart = '2026-06-18' // Planyo says 6/18
  const hqRead = readHQDateLA(hqStart)
  eq(hqRead === planyoStart, false, 'B start +1d drift: reader says 6/17, Planyo 6/18 → MISMATCH (drift caught)')
}
// 2) Convention-A end row, Planyo +1 day → reader gives 6/16, drift to 6/17 must be UPDATE_DATES.
{
  const hqEnd = new Date('2026-06-17T06:59:00.000Z') // Convention A end (= LA 6/16)
  const planyoEnd = '2026-06-17' // Planyo end shifted to 6/17
  const hqRead = readHQDateLA(hqEnd)
  eq(hqRead === planyoEnd, false, 'A end +1d drift: reader says 6/16, Planyo 6/17 → MISMATCH (drift caught)')
}
// 3) No-drift cases (positive cases — must NOT flag).
{
  const hqStartB = new Date('2026-06-17T00:00:00.000Z') // B start, intent 6/17
  eq(readHQDateLA(hqStartB), '2026-06-17', 'B start no drift → match')
  const hqEndA = new Date('2026-06-17T06:59:00.000Z') // A end, intent 6/16
  eq(readHQDateLA(hqEndA), '2026-06-16', 'A end no drift → match')
}
// 4) PST (winter): Convention A start at 08:00 UTC = LA midnight PST.
{
  const winterStartA = new Date('2026-01-10T08:00:00.000Z')
  eq(readHQDateLA(winterStartA), '2026-01-10', 'A start PST (08:00 UTC) → LA 1/10 midnight')
  const winterEndA = new Date('2026-01-11T07:59:00.000Z')
  eq(readHQDateLA(winterEndA), '2026-01-10', 'A end PST (07:59 UTC next day) → LA 1/10 23:59')
}

if (failures.length) {
  console.error('\nFAIL — ' + failures.length + ' failure(s):')
  for (const f of failures) console.error('  ' + f)
  process.exit(1)
}
console.log('\nAll date-convention tests passed.')
