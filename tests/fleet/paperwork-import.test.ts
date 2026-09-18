/**
 * Reading Julian's folder of DOT inspections and registrations onto the
 * fleet (2026-09-18).
 *
 *   npx tsx tests/fleet/paperwork-import.test.ts
 *   npm run test:paperwork-import
 *
 * Pure + offline: no DB, no blob, no env.
 *
 * The whole point of this file is the REFUSALS. Filing Cargo 25's
 * registration onto Cargo 2 hands a client a document with the wrong plate
 * and nobody finds out until an officer does, so a wrong match must be
 * impossible in a way a right match merely being missed is not.
 */

import {
  findDateInFilename,
  guessDocKind,
  matchUnit,
  planPaperworkImport,
  planSummary,
  tokenize,
  type ImportUnit,
} from '../../src/lib/fleet/paperworkImport'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

// The real roster shape, including the collisions that make this dangerous.
const UNITS: ImportUnit[] = [
  { id: 'u-c1', unitName: 'Cube 1' },
  { id: 'u-c10', unitName: 'Cube 10' },
  { id: 'u-c27', unitName: 'Cube 27' },
  { id: 'u-g2', unitName: 'Cargo 2' },
  { id: 'u-g22', unitName: 'Cargo 22' },
  { id: 'u-g25', unitName: 'Cargo 25' },
  { id: 'u-pv3', unitName: 'Passenger Van 3' },
]
const byId = (id: string) => UNITS.find((u) => u.id === id)!

console.log('tokenizing the shapes a scanner produces')
check('spaces', tokenize('Cube 27.pdf').join() === 'cube,27')
check('no separator at all', tokenize('cube27.pdf').join() === 'cube,27')
check('hyphens and underscores', tokenize('CUBE_27-REG.PDF').join() === 'cube,27,reg')
check('the extension goes', !tokenize('Cargo 22.pdf').includes('pdf'))
check('a scanner suffix survives as its own token', tokenize('Cargo 22 (1).pdf').join() === 'cargo,22,1')

console.log('\nmatching — the dangerous cases first')
const c1 = matchUnit('Cube 1 registration.pdf', UNITS)
check('"Cube 1" matches Cube 1 and NOT Cube 10', c1.kind === 'one' && c1.unit.id === 'u-c1')
const c10 = matchUnit('Cube 10 registration.pdf', UNITS)
check('"Cube 10" matches Cube 10, not Cube 1', c10.kind === 'one' && c10.unit.id === 'u-c10')
const g2 = matchUnit('cargo2_reg.pdf', UNITS)
check('"cargo2" is Cargo 2, never Cargo 22 or 25', g2.kind === 'one' && g2.unit.id === 'u-g2')
const g25 = matchUnit('CARGO 25 REGISTRATION 2026.pdf', UNITS)
check('"Cargo 25" is Cargo 25', g25.kind === 'one' && g25.unit.id === 'u-g25')

console.log('\nmatching — ordinary cases')
check('case and noise around the name', matchUnit('scan__cube-27__bit.pdf', UNITS).kind === 'one')
check('a multi-word unit name', (matchUnit('passenger van 3 reg.pdf', UNITS) as { unit: ImportUnit }).unit?.id === 'u-pv3')
check('nothing recognisable is none, not a guess', matchUnit('scan0012.pdf', UNITS).kind === 'none')
check('a unit that is not on the roster is none', matchUnit('Cube 99 reg.pdf', UNITS).kind === 'none')

console.log('\nmatching — refuses to pick between two trucks')
const two = matchUnit('Cargo 22 and Cargo 25 reg.pdf', UNITS)
check('one scan naming two trucks is ambiguous', two.kind === 'many')
check('and it says which two', two.kind === 'many' && two.units.map((u) => u.id).sort().join() === 'u-g22,u-g25')

console.log('\nregistration or DOT inspection')
check('reg', guessDocKind('Cube 27 registration.pdf') === 'registration')
check('short reg', guessDocKind('cube27_reg.pdf') === 'registration')
// ONE document, several names on the paper (Julian 2026-09-18): a truck
// carries a DOT ANNUAL inspection, a passenger van a CHP BIT. Every word
// anyone actually writes has to reach the same kind — "dot" was missing, and
// Julian names his scans "DOT", so his whole folder would have flagged for a
// manual pick on every row.
check("DOT — Julian's own word", guessDocKind('Cube 27 DOT 2026.pdf') === 'bit-certificate')
check('DOT inspection', guessDocKind('Cube 27 DOT inspection 2026-04-30.pdf') === 'bit-certificate')
check('annual', guessDocKind('Cube 27 annual 2026.pdf') === 'bit-certificate')
check('BIT still reads, for the vans', guessDocKind('Passenger Van 3 BIT 2026.pdf') === 'bit-certificate')
check('the word inspection', guessDocKind('Cargo 22 inspection.pdf') === 'bit-certificate')
check('neither word → ask', guessDocKind('Cube 27.pdf') === null)
check('BOTH words → ask, never pick one', guessDocKind('Cube 27 registration and bit.pdf') === null)
check('a DOT-and-registration name still asks', guessDocKind('Cube 27 DOT and registration.pdf') === null)
// A COI is a "certificate" too — that word must not drag a row into an
// inspection.
check('"certificate" alone is not an inspection', guessDocKind('Cube 27 certificate.pdf') === null)

console.log('\ndates — only what cannot mean two days')
check('ISO', findDateInFilename('Cube 27 BIT 2026-04-30.pdf') === '2026-04-30')
check('ISO run together', findDateInFilename('bit_20260430_cube27.pdf') === '2026-04-30')
check('US with a day that cannot be a month', findDateInFilename('BIT 04-30-2026.pdf') === '2026-04-30')
check('AMBIGUOUS US date is refused, not guessed', findDateInFilename('BIT 03-04-2026.pdf') === null)
check('a bare year is not a date', findDateInFilename('Cube 27 BIT 2026.pdf') === null)
check('no date at all', findDateInFilename('Cube 27 BIT.pdf') === null)
check('an impossible date is not read', findDateInFilename('BIT 2026-02-31.pdf') === null)

console.log('\nthe plan the operator reviews')
const plan = planPaperworkImport(
  [
    { filename: 'Cube 27 registration.pdf', isPdf: true },
    { filename: 'Cube 27 BIT 2026-04-30.pdf', isPdf: true },
    { filename: 'Cube 27 BIT.pdf', isPdf: true },
    { filename: 'Cargo 22 and Cargo 25 reg.pdf', isPdf: true },
    { filename: 'scan0012.pdf', isPdf: true },
    { filename: 'Cube 1.pdf', isPdf: true },
    { filename: 'Cube 10 reg.jpg', isPdf: false },
  ],
  UNITS,
)
check('a clean registration is ready', plan[0].ready && plan[0].kind === 'registration' && plan[0].unitId === 'u-c27')
check('a dated BIT is ready', plan[1].ready && plan[1].inspectionDate === '2026-04-30')
check('an undated BIT needs a date and is NOT ready', !plan[2].ready && plan[2].problems.includes('needs-date'))
check('two trucks in one name is not ready', !plan[3].ready && plan[3].problems.includes('many-units'))
check('and offers the candidates to choose from', plan[3].candidates.length === 2)
check('an unmatched file is not ready', !plan[4].ready && plan[4].problems.includes('no-unit'))
check('a matched file with no document kind is not ready', !plan[5].ready && plan[5].problems.includes('no-kind') && plan[5].unitId === 'u-c1')
check('a non-PDF is refused', !plan[6].ready && plan[6].problems.includes('not-pdf'))
check('rows keep their index back to the bytes', plan.map((r) => r.index).join() === '0,1,2,3,4,5,6')

console.log('\nthe operator overrides the guess')
const fixed = planPaperworkImport(
  [
    { filename: 'scan0012.pdf', isPdf: true, unitId: 'u-c27', kind: 'registration' },
    { filename: 'Cube 27 BIT.pdf', isPdf: true, inspectionDate: '2026-01-15' },
    { filename: 'Cargo 22 and Cargo 25 reg.pdf', isPdf: true, unitId: 'u-g22', kind: 'registration' },
  ],
  UNITS,
)
check('an unmatched file filed by hand becomes ready', fixed[0].ready && fixed[0].unitName === 'Cube 27')
check('a typed date unblocks a BIT', fixed[1].ready && fixed[1].inspectionDate === '2026-01-15')
check('picking one of two candidates resolves it', fixed[2].ready && fixed[2].unitId === 'u-g22')
check(
  'a unitId that is not on the roster is refused, not trusted',
  !planPaperworkImport([{ filename: 'x.pdf', isPdf: true, unitId: 'u-nope' }], UNITS)[0].ready,
)
check(
  'a bad typed date falls back to the filename rather than being stored',
  planPaperworkImport([{ filename: 'BIT 2026-04-30.pdf', isPdf: true, inspectionDate: 'soon' }], UNITS)[0].inspectionDate === '2026-04-30',
)

console.log('\nexpiry — typed, never inferred')
const exp = planPaperworkImport(
  [
    { filename: 'Cube 27 registration.pdf', isPdf: true, expiresAt: '2027-04-30' },
    { filename: 'Cube 27 registration.pdf', isPdf: true },
    // THE trap: the date in a BIT filename is the day it was INSPECTED. Read
    // as an expiry it would fire a renewal alert on every truck the moment
    // the folder is imported.
    { filename: 'Cargo 22 BIT 2026-04-30.pdf', isPdf: true },
    { filename: 'Cargo 22 BIT 2026-04-30.pdf', isPdf: true, expiresAt: '2028-04-30' },
    { filename: 'Cube 10 reg.pdf', isPdf: true, expiresAt: 'next year' },
  ],
  UNITS,
)
check('a typed expiry is kept', exp[0].expiresAt === '2027-04-30')
check('no expiry typed is null, and STILL ready', exp[1].expiresAt === null && exp[1].ready)
check(
  'the filename date becomes the INSPECTION date and never the expiry',
  exp[2].inspectionDate === '2026-04-30' && exp[2].expiresAt === null,
)
check('inspection and expiry are independent', exp[3].inspectionDate === '2026-04-30' && exp[3].expiresAt === '2028-04-30')
check('a malformed typed expiry is dropped, not stored', exp[4].expiresAt === null && exp[4].ready)
check('a missing expiry is never a problem on the row', exp.every((r) => !r.problems.includes('needs-date') || r.kind === 'bit-certificate'))

console.log('\nthe one-liner')
check('counts the stuck ones', planSummary(plan).includes('need'))
check('says so when nothing is stuck', planSummary(fixed) === '3 files matched — nothing to fix.')
check('empty', planSummary([]) === 'No files.')

if (failures.length) {
  console.error(`\n${failures.length} failed:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\nall good')
