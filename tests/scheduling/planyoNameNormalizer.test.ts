/**
 * Boundary tests for the Planyo unit_name normalizer used by the
 * migration script. Pure logic — no DB.
 *
 *   npx tsx tests/scheduling/planyoNameNormalizer.test.ts
 */

import { normalizePlanyoUnitName } from '../../src/lib/scheduling/planyoNameNormalizer'

const failures: string[] = []
function check(actual: { normalized: string; isBackupHold: boolean }, expected: { normalized: string; isBackupHold?: boolean }, label: string) {
  const ok = actual.normalized === expected.normalized && actual.isBackupHold === (expected.isBackupHold ?? false)
  if (!ok) failures.push(`${label}\n    got:      ${JSON.stringify(actual)}\n    expected: ${JSON.stringify(expected)}`)
  else console.log(`  ok — ${label}`)
}

console.log('Cube Truck — bare-number names get the "Cube" prefix')
check(normalizePlanyoUnitName('29 (A)', 'Cube Truck'), { normalized: 'Cube 29' }, '29 (A) → Cube 29')
check(normalizePlanyoUnitName('36', 'Cube Truck'), { normalized: 'Cube 36' }, '36 → Cube 36')
check(normalizePlanyoUnitName('18', 'Cube Truck'), { normalized: 'Cube 18' }, '18 → Cube 18')
check(normalizePlanyoUnitName('30 (A) Wardrobe', 'Cube Truck'), { normalized: 'Cube 30 Wardrobe' }, '30 (A) Wardrobe — only "(A)" stripped, "Wardrobe" preserved')
// Note: above one leaves an extra annotation in the unit; "Wardrobe" is not a
// standard Cube Truck Asset.unitName, so this is correctly flagged as "look me up".

console.log('\nCargo Van — "Super " prefix stripped + bare-number prefixing')
check(normalizePlanyoUnitName('Super Cargo #37 (A)', 'Cargo Van w/ Liftgate'), { normalized: 'Cargo 37' }, 'Super Cargo #37 (A) → Cargo 37')
check(normalizePlanyoUnitName('Super Cargo # 40 (A)', 'Cargo Van w/ Liftgate'), { normalized: 'Cargo 40' }, 'Super Cargo # 40 (A) → Cargo 40')
check(normalizePlanyoUnitName('Super Cargo #23', 'Cargo Van w/o Liftgate'), { normalized: 'Cargo 23' }, 'Super Cargo #23 (w/o Liftgate cat) → Cargo 23')

console.log('\nPassenger Van — bare-number + miscellaneous parens')
check(normalizePlanyoUnitName('6 (A)', 'Passenger Van'), { normalized: 'Pass 6' }, '6 (A) → Pass 6')
check(normalizePlanyoUnitName('1 (12 Pass) (Nissan) (A)', 'Passenger Van'), { normalized: 'Pass 1' }, 'multi-paren → Pass 1')
check(normalizePlanyoUnitName('2 (12 Pass) (Cargo Space) (A)', 'Passenger Van'), { normalized: 'Pass 2' }, 'multi-paren → Pass 2')
check(normalizePlanyoUnitName('10 (Mid Roof) (A)', 'Passenger Van'), { normalized: 'Pass 10' }, '10 (Mid Roof) (A) → Pass 10')
check(normalizePlanyoUnitName('8 (Mid Roof) A', 'Passenger Van'), { normalized: 'Pass 8' }, 'trailing slot-letter "A" stripped → Pass 8')
check(normalizePlanyoUnitName('9 (Mid Roof) A', 'Passenger Van'), { normalized: 'Pass 9' }, 'trailing slot-letter "A" stripped → Pass 9')
// Trailing "A" / "B" without parens — Planyo's "other" slot-indicator
// format (symmetric with the leading "A - "). Multi-letter trailing
// words like "Wardrobe" are NOT stripped — those need operator review.

console.log('\nPopVan + Camera Cube + DLUX')
check(normalizePlanyoUnitName('1 (A)', 'PopVan'), { normalized: 'Pop 1' }, '1 (A) → Pop 1')
check(normalizePlanyoUnitName('Camera Cube #1 (A)', 'Camera Cube'), { normalized: 'Cam 1' }, 'Camera Cube #1 (A) → Cam 1 (long → short prefix swap)')
check(normalizePlanyoUnitName('Camera Cube #2 (A)', 'Camera Cube'), { normalized: 'Cam 2' }, 'Camera Cube #2 (A) → Cam 2')
check(normalizePlanyoUnitName('DLUX #1 (2Room)', 'DLUX'), { normalized: 'DLUX 1' }, 'DLUX #1 (2Room) → DLUX 1')

console.log('\nStudios — "A - " slot prefix stripped, no category prefix prepended')
check(normalizePlanyoUnitName('A - Standing Sets', 'Studios'), { normalized: 'Standing Sets' }, '"A - Standing Sets" → "Standing Sets"')
check(normalizePlanyoUnitName('Lankershim Studio', 'Studios'), { normalized: 'Lankershim Studio' }, 'Lankershim Studio passes through unchanged')

console.log('\nBackup-hold (2ND HOLD) detection')
check(
  normalizePlanyoUnitName('A - Standing Sets (2ND HOLD)', 'Studios'),
  { normalized: 'Standing Sets', isBackupHold: true },
  'Backup hold on Standing Sets',
)
check(
  normalizePlanyoUnitName('Lankershim Studio (2ND Hold)', 'Studios'),
  { normalized: 'Lankershim Studio', isBackupHold: true },
  'Case-insensitive backup-hold detection',
)
check(
  normalizePlanyoUnitName('29 (A) (2ND HOLD)', 'Cube Truck'),
  { normalized: 'Cube 29', isBackupHold: true },
  'Backup hold + slot annotation + bare-number prefix all combined',
)

console.log('\nUnknown / pass-through (units that should NOT be auto-coerced)')
check(normalizePlanyoUnitName('Sprinter #1 (A)', 'Cargo Van w/ Liftgate'), { normalized: 'Sprinter 1' }, 'Sprinter passes through as "Sprinter 1" — no Asset, will be flagged missing')
check(normalizePlanyoUnitName('Sprinter #2 (A)', 'Cargo Van w/ Liftgate'), { normalized: 'Sprinter 2' }, 'Sprinter #2 → Sprinter 2')
check(normalizePlanyoUnitName('Video Van (w/ MiFi)', 'ProScout / VTR'), { normalized: 'Video Van' }, 'Video Van — no short-prefix mapping for ProScout, name passes through')
check(normalizePlanyoUnitName('Scout Van (No MiFi)', 'ProScout / VTR'), { normalized: 'Scout Van' }, 'Scout Van passes through')
check(
  normalizePlanyoUnitName('X - 2ND HOLD', 'ProScout / VTR'),
  { normalized: '', isBackupHold: true },
  'X - 2ND HOLD reduces to "" + isBackupHold=true; both the "X - " slot prefix and the "2ND HOLD" marker are stripped, leaving nothing. Empty string is a deliberate "no real unit" signal for the caller.',
)

console.log('')
if (failures.length === 0) {
  console.log(`✓ all checks passed`)
  process.exit(0)
} else {
  console.error(`✗ ${failures.length} failure(s):`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
