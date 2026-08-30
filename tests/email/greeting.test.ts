/**
 * Doubled-greeting guard.
 *
 *   npx tsx tests/email/greeting.test.ts
 *   npm run test:greeting
 *
 * Pure + offline.
 *
 * On 2026-08-29 a client received:
 *
 *     Hi Kacie,
 *     Hi again, Kacie!
 *
 * The templates render "Hi <First>," above the rep's words, but a rep in
 * the "Write my own email" box can't see that line, so they write their
 * own. The template now stands its greeting down when the draft already
 * opens with one.
 *
 * Both failure directions are live:
 *   - too LOOSE swallows the template greeting when the rep's first line
 *     was actually content, and the client gets an email with no greeting
 *   - too STRICT reproduces the bug this exists to prevent
 */

import { startsWithGreeting } from '../../src/lib/email/greeting'

const failures: string[] = []

function yes(body: string | null, name: string | null, why: string): void {
  if (startsWithGreeting(body, name)) console.log(`  ok — ${why}`)
  else failures.push(`should be treated as a greeting: ${why} (${JSON.stringify(body)})`)
}
function no(body: string | null, name: string | null, why: string): void {
  if (!startsWithGreeting(body, name)) console.log(`  ok — ${why}`)
  else failures.push(`should NOT be treated as a greeting: ${why} (${JSON.stringify(body)})`)
}

// ── The email that actually went out ─────────────────────────────────
console.log('The send that caused this\n')

yes('Hi again, Kacie!\n\nPlease take a look at the adjusted quote.', 'Kacie',
  '"Hi again, Kacie!" — the exact line a client saw doubled')

// ── Ordinary openers ─────────────────────────────────────────────────
console.log('\nOpeners a rep actually types\n')

yes('Hi Kacie,\n\nHere is the quote.', 'Kacie', '"Hi Kacie,"')
yes('Hello Kacie,\n\nHere is the quote.', 'Kacie', '"Hello Kacie,"')
yes('Hey Kacie -\n\nHere is the quote.', 'Kacie', '"Hey Kacie -"')
yes('Hi there,\n\nHere is the quote.', 'Kacie', '"Hi there," — no name, still a greeting')
yes('Hi!\n\nHere is the quote.', 'Kacie', 'a bare "Hi!"')
yes('  \n\nHi Kacie,\n\nBody', 'Kacie', 'leading blank lines are skipped')
yes('hi kacie\n\nBody', 'Kacie', 'lowercase, unpunctuated')
yes('Good morning Kacie,\n\nBody', 'Kacie', 'two-word opener')

// ── Content that merely begins with a greeting word ──────────────────
console.log('\nFirst lines that are CONTENT, not a greeting\n')

no('Hi Kacie, quick update on the truck.', 'Kacie',
  'greeting + a sentence on one line is the first sentence, not a bare greeting')
no('Highway permits are sorted.', 'Kacie', '"Highway" is not "Hi"')
no('Hello — the generator swap is confirmed for Tuesday.', 'Kacie',
  'an opener followed by real content')
no('Please take a look at the adjusted quote.', 'Kacie', 'no opener at all')
no('Heads up: the cube truck moved to Thursday.', 'Kacie', '"Heads" is not "Hey"')

// ── Degenerate input ─────────────────────────────────────────────────
console.log('\nDegenerate input\n')

no('', 'Kacie', 'empty body')
no('   \n  \n', 'Kacie', 'whitespace only')
no(null, 'Kacie', 'null body')
yes('Hi Kacie,', null, 'works with no name supplied')

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All greeting checks passed.')
