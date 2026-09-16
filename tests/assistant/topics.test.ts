/**
 * Editable troubleshooting topic tests (the pure parts).
 *
 *   npm run test:aha-topics
 *
 * Wes 2026-09-16 wanted sections ops can modify. The risk in that is a
 * textarea becoming AHA's instructions with nobody checking the shape, so
 * what is pinned here is: lines parse the way a person types them, a step
 * splits into a name and an instruction, the generated brief carries the
 * STOP boundary, and the seed content itself is safe.
 */
import { buildBrief, fromRow, lines, splitCheck } from '../../src/lib/assistant/topics'
import { TROUBLESHOOTING_GUIDES } from '../../src/lib/site/troubleshooting'

let failed = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`)
  else { failed++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

console.log('lines — how people actually type into a textarea')
check('blank lines are dropped', lines('a\n\n\nb').length === 2)
check('trailing spaces go', lines('  a  \n b ')[0] === 'a')
check('a pasted bullet loses its dash', lines('- start the truck')[0] === 'start the truck')
check('bullet characters too', lines('• check the switch\n* and the latch').every((l) => !/^[-•*]/.test(l)))
check('empty input is an empty list', lines('').length === 0 && lines(null).length === 0)

console.log('splitCheck')
check('em dash splits name from instruction', splitCheck('Start the truck — it runs off the battery').title === 'Start the truck')
check('...and keeps the body', splitCheck('Start the truck — it runs off the battery').body === 'it runs off the battery')
check('en dash works too', splitCheck('Set the brake – many gates interlock').body === 'many gates interlock')
check('a colon works', splitCheck('Check the switch: often in the cab').title === 'Check the switch')
check('a bare line is all title', splitCheck('Start the truck').title === 'Start the truck' && splitCheck('Start the truck').body === '')
check('a hyphenated word is not a split', splitCheck('Check the lock-box latch').body === '')

console.log('buildBrief')
const brief = buildBrief({
  title: 'Lift gate will not work',
  symptoms: ['gate is dead'],
  checks: [{ title: 'Start the truck', body: 'it runs off the battery' }, { title: 'Set the brake', body: '' }],
  stopIf: ['Anyone is under the gate'],
})
check('the title leads, upper-cased', brief.startsWith('LIFT GATE WILL NOT WORK'))
check('steps are numbered in order', brief.includes('1. Start the truck — it runs off the battery') && brief.includes('2. Set the brake'))
check('a body-less step has no trailing dash', !brief.includes('2. Set the brake —'))
check('symptoms are carried', brief.includes('gate is dead'))
check('the STOP boundary is in the brief', /STOP and get them a person/.test(brief) && brief.includes('Anyone is under the gate'))
check('no stop conditions means no stop line', !buildBrief({ title: 'x', symptoms: [], checks: [], stopIf: [] }).includes('STOP'))

console.log('fromRow')
const row = {
  slug: 'lift-gate', title: 'Lift gate will not work', eyebrow: 'Troubleshooting', summary: 's',
  symptoms: 'gate is dead\n', checks: 'Start the truck — battery\nSet the brake', stopIf: 'Anyone under it',
  tellUs: 'Unit number', assistantBrief: null,
}
check('a row with no override generates its brief', fromRow(row).assistantBrief.startsWith('LIFT GATE WILL NOT WORK'))
check('steps parse into title + body', fromRow(row).checks[0].body === 'battery')
check('an override wins', fromRow({ ...row, assistantBrief: 'CUSTOM' }).assistantBrief === 'CUSTOM')
check('a blank override does not win', fromRow({ ...row, assistantBrief: '   ' }).assistantBrief.startsWith('LIFT GATE'))
check('a stored row is not marked as seed', fromRow(row).fromSeed === false)

console.log('the built-in content is safe')
for (const g of TROUBLESHOOTING_GUIDES) {
  check(`${g.slug}: has a stop boundary`, g.stopIf.length > 0)
  check(`${g.slug}: has steps`, g.checks.length > 0)
  check(`${g.slug}: tells us what to collect on hand-off`, g.tellUs.length > 0)
  check(`${g.slug}: the brief carries its stop conditions`, /STOP/.test(g.assistantBrief))
  // A naive "does the word bypass appear" check fails on the lift-gate
  // brief, which says "NEVER suggest bypassing a safety interlock" — a
  // prohibition, the opposite of the risk. So: every mention has to sit in
  // a sentence that negates it.
  const sentences = (g.assistantBrief + ' ' + g.checks.map((c) => `${c.title}. ${c.body}`).join(' '))
    .split(/(?<=[.;:])\s+|\n/)
    .filter(Boolean)
  const unsafe = sentences.filter(
    (line) => /bypass|defeat|disable|jump(?:er)? the interlock|override/i.test(line) && !/\b(never|do not|don't|not|no)\b/i.test(line),
  )
  check(`${g.slug}: only ever forbids bypassing a safety interlock`, unsafe.length === 0, unsafe)
}
check('slugs are unique', new Set(TROUBLESHOOTING_GUIDES.map((g) => g.slug)).size === TROUBLESHOOTING_GUIDES.length)
check('lift gate is one of them', TROUBLESHOOTING_GUIDES.some((g) => g.slug === 'lift-gate'))

if (failed) { console.log(`\n${failed} failing`); process.exit(1) }
console.log('\nall passing')
