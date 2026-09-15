/**
 * "Why we landed here" assembly — the client-facing explanation beside the
 * counter-proposal.
 *
 *   npx tsx tests/contract-review/counter-explanation.test.ts
 *   npm run test:counter-explanation
 *
 * Pure + offline (no model call). Guards the failures a client would see:
 * a chip that disagrees with the PDF, a clause missing from the list, and
 * internal negotiation vocabulary reaching the page.
 */

import { assembleExplanation, buildExplanationItems, isRemovalText } from '../../src/lib/contracts/counterExplanation'

const failures: string[] = []
function check(got: unknown, want: unknown, why: string) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'ok' : 'FAIL'} — ${why}${ok ? '' : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`)
  if (!ok) failures.push(why)
}

const changes = [
  { clause: '1', description: 'Adds mutual indemnity.', proposed: 'mutual text', reasoning: 'Material risk shift.', suggestedCounter: 'our counter' },
  { clause: '10', description: 'Adds a cure period.', proposed: 'cure text', reasoning: 'Fine.' },
  { clause: '1', description: 'Narrows indemnity scope.', proposed: 'narrow', reasoning: 'x' },
  { clause: '30-new', description: 'Adds Rights in Recordings.', proposed: 'recordings', reasoning: 'Out of scope.' },
  { clause: '12', description: 'Still pending.', proposed: 'p', reasoning: 'r' },
]
const decisions = [
  { changeIndex: 3, clauseRef: '30-new', decision: 'REJECT', counterLanguage: null, note: null },
  { changeIndex: 0, clauseRef: '1', decision: 'COUNTER', counterLanguage: null, note: 'Happy to cover our sole negligence.' },
  { changeIndex: 1, clauseRef: '10', decision: 'ACCEPT', counterLanguage: null, note: null },
  { changeIndex: 2, clauseRef: '1', decision: 'REJECT', counterLanguage: null, note: null },
  { changeIndex: 4, clauseRef: '12', decision: 'PENDING', counterLanguage: null, note: null },
]
const items = buildExplanationItems(changes, decisions)
check(items.map((i) => i.clauseRef), ['1', '10', '1', '30-new'], 'decided clauses only, in change order')
check(items[0].landedOn, 'our counter', 'COUNTER with no typed language lands on the suggested counter')
check(items[3].added, true, 'client-added clause detected')

const parsed = {
  intro: 'Thanks for the careful review.',
  closing: 'Reply to your rep with anything.',
  clauses: [
    { id: '1', headline: 'Protection both ways', explanation: 'We cover our own negligence.' },
    { id: '2', headline: 'Happy to add a cure period', explanation: 'Per our playbook fallback, this is fine.' },
    { id: '4', headline: 'Not something we can add', explanation: 'Recording rights sit outside a vehicle rental.' },
  ],
}
const out = assembleExplanation(parsed, items, new Date('2026-09-15T10:00:00Z'))
check(out.clauses.length, 4, 'every decided clause present, even ones the writer skipped')
check(out.clauses.map((c) => c.outcomeLabel), ['Our suggested wording', 'Accepted as you proposed', 'Kept our standard wording', 'Not included'], 'chips come from the decision')
check(out.clauses[1].explanation.includes('playbook'), false, 'internal vocabulary scrubbed')
check(out.clauses[1].headline, 'Happy to add a cure period', 'a clean headline survives beside a scrubbed explanation')
check(out.clauses[2].explanation.startsWith("We've kept our standard wording for §1"), true, 'skipped clause gets the outcome sentence')
check(out.forCounterAt, '2026-09-15T10:00:00.000Z', 'stamped with the counter it explains')
const noAi = assembleExplanation({ intro: 'Our AI reviewed your redline.' }, items, new Date())
check(noAi.intro.includes('AI'), false, '"AI" in the intro falls back to the default')
check(assembleExplanation({ intro: 'We kept the details simple.' }, items, new Date()).intro, 'We kept the details simple.', '"details" is not "AI"')

console.log('clause refs')
const refItems = buildExplanationItems(
  [
    { clause: '15 (missing)', description: 'Removes subrogation.', proposed: '', reasoning: 'Subrogation removed.' },
    { clause: '22 (new)', description: 'Adds Rights in Recordings.', proposed: 'Recordings belong to Client.', reasoning: 'x', suggestedCounter: 'Recordings  belong to Client.' },
    { clause: '24 (renumbered)', description: 'Wear and tear on return.', proposed: 'p', reasoning: 'x' },
  ],
  [
    { changeIndex: 0, clauseRef: '15 (missing)', decision: 'ACCEPT', counterLanguage: null, note: null },
    { changeIndex: 1, clauseRef: '22 (new)', decision: 'COUNTER', counterLanguage: null, note: null },
    { changeIndex: 2, clauseRef: '24 (renumbered)', decision: 'ACCEPT', counterLanguage: null, note: null },
  ],
)
check(refItems.map((i) => i.title), ['§15 Subrogation', '§22', '§24'], 'our title only for OUR clause; client numbering is named by the writer')
check(refItems.map((i) => i.added), [false, true, false], 'new = added; missing / renumbered are not')
check(refItems[1].outcome, 'ACCEPT', 'a counter identical to their wording reads as accepted')
const named = assembleExplanation(
  { clauses: [{ id: '2', name: 'Rights in Recordings', headline: 'Your footage is yours', explanation: 'Included as you wrote it.' }] },
  refItems,
  new Date(),
)
check(named.clauses[1].title, '§22 Rights in Recordings', "the writer's name completes an unnamed ref")
check(named.clauses[1].outcomeLabel, 'Included as you wrote it', 'added + accepted label')

const more = buildExplanationItems(
  [
    { clause: '23 (new)', description: 'Adds injunctive relief waiver.', proposed: 'Lessor waives injunctive relief.', reasoning: 'x' },
    { clause: 'Fleet Agreement', description: 'Removes the Fleet Agreement.', proposed: '', reasoning: 'x' },
  ],
  [
    { changeIndex: 0, clauseRef: '23 (new)', decision: 'COUNTER', counterLanguage: 'Intentionally omitted.', note: null },
    { changeIndex: 1, clauseRef: 'Fleet Agreement', decision: 'ACCEPT', counterLanguage: null, note: null },
  ],
)
check(more[0].outcome, 'REJECT', 'a counter that omits an added clause reads "Not included"')
check([more[1].added, more[1].title], [false, 'Fleet Agreement'], 'an unnumbered section of ours is not a client addition, and gets no §')
const fleet = assembleExplanation({ clauses: [{ id: '2', name: 'Fleet Agreement', headline: 'Accepted as you proposed', explanation: 'Left out.' }] }, more, new Date())
check([fleet.clauses[1].title, fleet.clauses[1].headline], ['Fleet Agreement', ''], 'no doubled name; a headline that repeats the chip is dropped')
check([isRemovalText('[Omitted]'), isRemovalText('Lessor may seek injunctive relief only for return of Equipment.')], [true, false], 'removal wording detected, real wording not')

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`)
  process.exit(1)
}
console.log('\nall passed')
