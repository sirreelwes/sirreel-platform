/**
 * Platform-memory search tests (the pure parts).
 *
 *   npm run test:memory-search
 *
 * The continuity tool hands an admin sections of the written record. What
 * is pinned: markdown splits at headings; the best-matching sections come
 * first with heading hits weighted; nothing matches when the question has
 * no real words; and a line that looks like a credential never leaves the
 * module even if a document carries one.
 */
import { rankSections, redact, splitSections, terms } from '../../src/lib/assistant/memory'

let failed = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`)
  else { failed++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

const md = `# SirReel HQ

Intro paragraph about the platform.

## Reservations
Planyo remains the working surface until the switch. HQ's scheduler holds the live book.

## Collections
Ana charges HQ invoices from the collections panel. A PAID stamp lands on settled invoice PDFs.

### CardPointe
Card processing is live.
TWILIO_API_KEY_SECRET=abcd1234efgh5678ijkl9012mnop3456
Never put production credentials in .env.local.
`

console.log('splitSections')
const secs = splitSections('CLAUDE.md', md)
check('one section per heading, intro kept under the top heading', secs.length === 4 && secs[0].heading === 'SirReel HQ', secs.map((s) => s.heading))
check('h3 is its own section', secs.some((s) => s.heading === 'CardPointe'))

console.log('terms')
check('drops stop words and short tokens', JSON.stringify(terms('How do reservations and Planyo relate to HQ?')) === JSON.stringify(['reservations', 'planyo', 'relate']))

console.log('rankSections')
const r1 = rankSections('how do reservations and planyo relate', secs)
check('the reservations section ranks first', r1[0]?.heading === 'Reservations', r1.map((s) => s.heading))
const r2 = rankSections('what is the collections panel', secs)
check('collections ranks first for a collections question', r2[0]?.heading === 'Collections', r2.map((s) => s.heading))
check('unrelated sections are left out', !r2.some((s) => s.heading === 'Reservations'))
check('no real words → nothing', rankSections('the of and', secs).length === 0)

console.log('redact')
const card = secs.find((s) => s.heading === 'CardPointe')!
const out = redact(card.text)
check('a key=value line is replaced', !out.includes('abcd1234') && out.includes('[redacted]'), out)
check('ordinary lines survive', out.includes('Card processing is live.') && out.includes('Never put production credentials'))

if (failed) { console.log(`\n${failed} failing`); process.exit(1) }
console.log('\nall passing')
