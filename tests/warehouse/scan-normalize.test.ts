/**
 * Scan normalisation — what counts as the same label, and what doesn't.
 *
 *   npx tsx tests/warehouse/scan-normalize.test.ts
 *   npm run test:scan
 *
 * Pure + offline: no DB. `resolveScan` needs Prisma; `normalizeScan` is the
 * part that decides whether two reads of the same physical label are treated
 * as the same code, and it is the piece a scanner's quirks land on.
 *
 * Both failure directions cost something real at the shelf. Too STRICT and a
 * wedge scanner that emits Code 39's asterisk delimiters fails on every read,
 * which is exactly the "the scan box doesn't work" the barcode work exists to
 * fix. Too LOOSE and a malformed read gets silently repaired into a valid
 * barcode — and the wrong unit goes on the truck.
 *
 * Fixtures are real: SirReel's labels are SR###### printed as *SR######*
 * (measured off the RW register, 2026-09-02), and the catalog also holds
 * descriptive codes with quotes and spaces that must survive untouched.
 */

import { normalizeScan } from '../../src/lib/warehouse/resolveScan'

const failures: string[] = []

function check(raw: string, want: string, why: string): void {
  const got = normalizeScan(raw)
  if (got === want) {
    console.log(`  ok — ${why}`)
  } else {
    failures.push(`${why}: ${JSON.stringify(raw)} → ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
  }
}

console.log('\nCode 39 delimiters — the reason this function exists')
check('SR004674', 'SR004674', 'a bare barcode is untouched')
check('*SR004674*', 'SR004674', 'wedge scanner emitting both delimiters')
check('  *SR004674*  ', 'SR004674', 'delimiters plus the trailing whitespace a scanner adds')

console.log('\nCase — scanners and humans disagree about it')
check('sr004674', 'SR004674', 'typed lowercase reaches the same unit')
check('Sr004674', 'SR004674', 'mixed case from a phone keyboard')

console.log('\nMalformed reads must NOT be repaired into valid codes')
check('*SR004674', '*SR004674', 'one leading asterisk is a partial read, not a delimiter')
check('SR004674*', 'SR004674*', 'one trailing asterisk likewise')
check('SR 004674', 'SR 004674', 'an interior space is a different string — never squeezed out')
check('SR-004674', 'SR-004674', 'a hyphen is not noise; it belongs to the code')

console.log('\nCatalog codes travel the same path and must survive it')
check('1" SQUARE COUPLER', '1" SQUARE COUPLER', 'quotes and spaces in a descriptive catalog code')
check('103828', '103828', 'a numeric RW I-code used as a catalog code')

console.log('\nDegenerate input')
check('', '', 'empty stays empty — the caller refuses it')
check('   ', '', 'whitespace-only collapses to empty rather than a bogus code')
check('**', '**', 'two asterisks are not a wrapper around nothing')

if (failures.length) {
  console.error(`\n✗ ${failures.length} failure(s):`)
  failures.forEach((f) => console.error(`   ${f}`))
  process.exit(1)
}
console.log('\n✓ scan normalisation holds\n')
