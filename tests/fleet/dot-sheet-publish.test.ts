/**
 * When the client's DOT sheet appears on their portal (2026-09-17).
 *
 *   npx tsx tests/fleet/dot-sheet-publish.test.ts
 *   npm run test:dot-sheet-publish
 *
 * Pure + offline: no DB, no PDF, no env.
 *
 * The sheet became DERIVED — downloads render from the units assigned right
 * now, so it cannot go stale. What still needs pinning is the GATE, because
 * it is the half that decides what a client sees: a complete record goes up
 * by itself, an incomplete one is withheld until a human sends it anyway, and
 * an order with no trucks left publishes nothing whatever a stale timestamp
 * says.
 */

import {
  clientStatusLabel,
  clientWaitingNote,
  deskBlockerSentence,
  dotSheetState,
  missingDotFields,
} from '../../src/lib/fleet/dotSheetPublish'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

const NONE: { unitName: string; missing: string[] }[] = []
const published = new Date('2026-09-16T10:00:00Z')
const gap = [{ unitName: 'Cube 27', missing: ['VIN', 'DOT inspection'] }]

console.log('what a unit owes')
const full = { vin: '1FTBW2CM5NKA12345', licensePlate: '8ABC123', year: 2022, make: 'Ford', hasBitInspection: true }
check('a complete unit owes nothing', missingDotFields(full).length === 0)
check('a missing model is NOT a gap — plenty of registrations carry none', missingDotFields({ ...full, make: 'Ford' }).length === 0)
check('every field is named when bare', missingDotFields({ hasBitInspection: false }).join() === 'VIN,license plate,year,make,DOT inspection')
check('an empty string counts as missing, not as present', missingDotFields({ ...full, vin: '' }).join() === 'VIN')
check('year 0 does not read as a year', missingDotFields({ ...full, year: 0 }).join() === 'year')
check('no inspection on file is a gap on its own', missingDotFields({ ...full, hasBitInspection: false }).join() === 'DOT inspection')

console.log('\npublishes by itself')
const complete = dotSheetState({ unitCount: 2, gaps: NONE, publishedAt: null })
check('a complete record is available with nobody pressing anything', complete.available && complete.automatic)
check('and says so', complete.reason === 'complete')
check(
  'a complete record does not need the old button — publishing again changes nothing',
  dotSheetState({ unitCount: 2, gaps: NONE, publishedAt: published }).reason === 'complete',
)

console.log('\nwithheld')
const blocked = dotSheetState({ unitCount: 2, gaps: gap, publishedAt: null })
check('blanks in the record hold it back', !blocked.available && blocked.reason === 'incomplete')
check('the gaps come back for the desk', blocked.gaps.length === 1 && blocked.gaps[0].missing.join() === 'VIN,DOT inspection')
check('a unit with an empty missing[] is not a gap', dotSheetState({ unitCount: 1, gaps: [{ unitName: 'Van 3', missing: [] }], publishedAt: null }).available)

console.log('\nthe override')
const anyway = dotSheetState({ unitCount: 2, gaps: gap, publishedAt: published })
check('a rep having sent it keeps it up', anyway.available && anyway.reason === 'published-with-gaps')
check('but it was never automatic', !anyway.automatic)
check('and the gaps are still reported, not forgotten', anyway.gaps.length === 1)

console.log('\nno units')
// The case the stored snapshot got wrong: a published order whose trucks were
// all released went on serving the PDF it had when it had them.
const emptied = dotSheetState({ unitCount: 0, gaps: NONE, publishedAt: published })
check('releasing every unit withdraws the sheet, despite the publish stamp', !emptied.available)
check('and it reads as no-units, not as withheld work', emptied.reason === 'no-units')
check('nothing is claimed about gaps', emptied.gaps.length === 0)
check('a negative count cannot slip through as available', !dotSheetState({ unitCount: -1, gaps: NONE, publishedAt: published }).available)

console.log('\nwhat each side is told')
check('available: no waiting note', clientWaitingNote(complete) === null)
check(
  'no trucks yet: the client is told to wait for the pick',
  (clientWaitingNote(emptied) ?? '').includes('once your trucks are picked'),
)
check(
  'withheld: the client is NOT told which VIN we are missing',
  !(clientWaitingNote(blocked) ?? '').match(/VIN|plate|BIT|DOT inspection/i),
)
check('withheld: but is told it is coming', (clientWaitingNote(blocked) ?? '').includes('Being prepared'))
check('status words match the notes', clientStatusLabel(complete) === 'Available' && clientStatusLabel(emptied) === 'When vehicles are assigned' && clientStatusLabel(blocked) === 'Being prepared')
check('the override reads as available to the client', clientStatusLabel(anyway) === 'Available')

check('the desk DOES get the specifics', (deskBlockerSentence(blocked) ?? '').includes('Cube 27 (VIN, DOT inspection)'))
check('no blocker sentence once it is up', deskBlockerSentence(complete) === null && deskBlockerSentence(anyway) === null)
check('no blocker sentence with no units — that is a different worklist', deskBlockerSentence(emptied) === null)

const many = dotSheetState({
  unitCount: 5,
  gaps: ['A', 'B', 'C', 'D'].map((n) => ({ unitName: n, missing: ['VIN'] })),
  publishedAt: null,
})
check('a long blocker names three and counts the rest', (deskBlockerSentence(many) ?? '').endsWith('+1 more'))

console.log('\ncallers cannot mutate what they passed in')
const mine = [{ unitName: 'Cube 27', missing: ['VIN'] }]
const st = dotSheetState({ unitCount: 1, gaps: mine, publishedAt: null })
st.gaps[0].missing.push('tampered')
check('gaps are copied out, not aliased', mine[0].missing.join() === 'VIN')

if (failures.length) {
  console.error(`\n${failures.length} failed:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\nall good')
