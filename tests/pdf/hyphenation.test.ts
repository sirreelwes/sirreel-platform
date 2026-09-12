/**
 * PDF hyphenation policy — where a word MAY fold on paper.
 *
 *   npx tsx tests/pdf/hyphenation.test.ts
 *   npm run test:pdf-hyphenation
 *
 * Pure + offline: `hyphenateWord` is the callback handed to
 * Font.registerHyphenationCallback; this pins it without rendering a PDF.
 *
 * The callback lists the pieces the layout engine may break a word into.
 * The engine breaks ONLY when the word does not fit its column, so listing
 * break points for a short code costs nothing, while withholding them from
 * a long one prints it straight over the next column. 2026-09-12: the pick
 * list for S260902-008 printed "CAT_CUBE_TRUCK" (14 glyphs, wider than the
 * 12% Item Code column) on top of "SuperCube Truck" because folding was
 * gated on `length > 14`.
 */

import { hyphenateWord } from '../../src/lib/pdf/hyphenation'

const failures: string[] = []

function check(word: string, want: string[], why: string): void {
  const got = hyphenateWord(word)
  if (JSON.stringify(got) === JSON.stringify(want)) {
    console.log(`  ok — ${why}`)
  } else {
    failures.push(`${why}: ${JSON.stringify(word)} → ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
  }
}

console.log('\nCodes fold at their separators, whatever their length')
check('CAT_CUBE_TRUCK', ['CAT_', 'CUBE_', 'TRUCK'], 'the 14-glyph code that overprinted the description')
check('CAT_VAN', ['CAT_', 'VAN'], 'a short code lists its break points too (the engine ignores them when it fits)')
check('VEH--STRAPS--RATCHET', ['VEH--', 'STRAPS--', 'RATCHET'], 'a double separator stays together at the end of a part')
check('A_-B', ['A_-', 'B'], 'a mixed separator run stays together')
check('TEN-CARAVAN-CANOPY-10X10', ['TEN-', 'CARAVAN-', 'CANOPY-', '10X10'], 'hyphenated code convention')
check('CAT_CARGO_VAN_LIFTGATE', ['CAT_', 'CARGO_', 'VAN_', 'LIFTGATE'], 'underscore code convention')

console.log('\nEvery part is re-joinable: the separator stays as the trailing glyph')
for (const code of ['CAT_CUBE_TRUCK', 'VEH--STRAPS--RATCHET', 'TEN-CARAVAN-CANOPY-10X10']) {
  const joined = hyphenateWord(code).join('')
  if (joined === code) console.log(`  ok — ${code} round-trips`)
  else failures.push(`${code} round-trip: parts join to ${JSON.stringify(joined)}`)
}

console.log('\nA segment wider than the column is chunked')
check('CAT_SUPERCUBE_TRUCK', ['CAT_', 'SUPERCUB', 'E_', 'TRUCK'], 'a 10-glyph segment splits at 8')
check('ABCDEFGHIJKLMNOP', ['ABCDEFGH', 'IJKLMNOP'], 'a separator-less run over 14 chunks per 8')

console.log('\nOrdinary words stay atomic')
check('Productions', ['Productions'], 'mixed case never hyphenates')
check('SUPERCUBE', ['SUPERCUBE'], 'a separator-less all-caps word of 14 or fewer is one piece')
check('PM', ['PM'], 'a short all-caps token is one piece')
check('10X10', ['10X10'], 'digits and caps with no separator stay whole')
check('Dunwell-Productions', ['Dunwell-Productions'], 'a hyphenated NAME is not a code — no mid-name fold')

if (failures.length) {
  console.error(`\n✗ ${failures.length} failure(s):`)
  failures.forEach((f) => console.error(`   ${f}`))
  process.exit(1)
}
console.log('\n✓ pdf hyphenation policy holds\n')
