/**
 * Configuration-note suggestions (src/lib/catalog/configNotes.ts).
 *
 * Run: npx tsx tests/catalog/config-notes.test.ts
 */
import {
  configNotesFor,
  configNotesForCategoryName,
  appendConfigNote,
} from '../../src/lib/catalog/configNotes'

let failures = 0
function check(ok: boolean, label: string) {
  if (ok) console.log(`  ok — ${label}`)
  else { failures++; console.log(`  FAIL — ${label}`) }
}

console.log('\nBoth halves of the passenger-van split carry the seating suggestion')
check(configNotesFor('CAT_PASSENGER_VAN_12').includes('Remove last row of seats'),
  '12-passenger offers "Remove last row of seats"')
check(configNotesFor('CAT_PASSENGER_VAN_15').includes('Remove last row of seats'),
  '15-passenger offers it too')
check(configNotesFor('CAT_PASSENGER_VAN').includes('Remove last row of seats'),
  'and so does the retired pre-split code — an old line opened for edit is not broken')

console.log('\nNothing is suggested where nothing is known')
check(configNotesFor('CAT_CUBE_TRUCK').length === 0, 'a cube truck offers no configuration note')
check(configNotesFor(null).length === 0, 'a line with no catalog binding offers none')
check(configNotesFor(undefined).length === 0, 'and neither does undefined')

console.log('\nThe hold modal reaches the same text by category name')
check(configNotesForCategoryName('15-Passenger Van').includes('Remove last row of seats'),
  '"15-Passenger Van" resolves to the same suggestion the code does')
check(configNotesForCategoryName('  12-Passenger Van  ').length === 1, 'surrounding whitespace does not defeat it')
// 2026-09-11: "Passenger Van" is the LIVE merged class again (merge-passenger-
// vans.ts) — the seating size is a note on it, so the name resolves and
// offers the size chips.
check(configNotesForCategoryName('Passenger Van').includes('12-passenger (Pass 1 or Pass 2)'),
  'the merged display name offers the seating-size chips')
check(configNotesForCategoryName(null).length === 0, 'a missing name is not an error')

console.log('\nAppending is idempotent — the chip sits in a form reps double-click')
check(appendConfigNote('', 'Remove last row of seats') === 'Remove last row of seats',
  'first click writes the note')
check(appendConfigNote(null, 'Remove last row of seats') === 'Remove last row of seats',
  'a null note is treated as empty, not concatenated onto "null"')
check(appendConfigNote('Remove last row of seats', 'Remove last row of seats') === 'Remove last row of seats',
  'second click does NOT print the sentence twice on the client\'s quote')
check(appendConfigNote('remove LAST row of SEATS', 'Remove last row of seats') === 'remove LAST row of SEATS',
  'a hand-typed version of the same sentence is not duplicated either')
check(appendConfigNote('Client picks up at 6am', 'Remove last row of seats')
  === 'Client picks up at 6am\nRemove last row of seats',
  'an unrelated existing note is kept, and the suggestion lands on its own line')
check(appendConfigNote('  Client picks up at 6am  ', 'Remove last row of seats')
  === 'Client picks up at 6am\nRemove last row of seats',
  'stray whitespace is trimmed rather than baked into the quote')

if (failures) { console.log(`\n✗ ${failures} failure(s)`); process.exitCode = 1 }
else console.log('\n✓ all config-note checks passed')
