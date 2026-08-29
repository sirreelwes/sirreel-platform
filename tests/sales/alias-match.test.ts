/**
 * Catalog alias matching.
 *
 *   npx tsx tests/sales/alias-match.test.ts
 *   npm run test:alias-match
 *
 * Pure + offline.
 *
 * Guards a predicate with two opposite failure modes, both of which have
 * actually shipped:
 *
 *   TOO STRICT — `aliases: { has: token }` against a tokenized, AND-ed
 *   query meant no multi-word alias could ever match. Every curated
 *   translation in scripts/seed-catalog-aliases.ts was inert and nobody
 *   noticed, because the failure is an empty dropdown, not an error.
 *
 *   TOO LOOSE — substring matching brings the multi-word aliases back and
 *   overshoots: "walkie" is a substring of "analog walkie", so the analog
 *   radio rides along. Wes's 8/17 ruling is that a bare walkie IS the
 *   digital one; both radios cost the same, so this isn't billing, it's
 *   which SKU lands on the pull sheet.
 */

import { aliasesAnswerQuery } from '../../src/lib/sales/aliasMatch'

const failures: string[] = []

/** Mirrors the route: each token carries its singular/plural variants. */
const q = (...tokens: string[][]): string[][] => tokens

function yes(aliases: string[], variants: string[][], why: string): void {
  if (aliasesAnswerQuery(aliases, variants)) console.log(`  ok — ${why}`)
  else failures.push(`should MATCH: ${why}`)
}
function no(aliases: string[], variants: string[][], why: string): void {
  if (!aliasesAnswerQuery(aliases, variants)) console.log(`  ok — ${why}`)
  else failures.push(`should NOT match: ${why}`)
}

const DIGITAL = ['walkie', 'walkie talkie', 'handheld', 'two-way radio', 'radio', 'cp200']
const ANALOG = ['analog', 'analog walkie', 'analog radio', 'cp200 analog', 'analogue']
const RACK = ['garment rack', 'clothing rack']
const LINERS = ['trash can liner', 'can liner', 'trash liner', 'trash bag', 'garbage bag']

// ── The multi-word aliases that were dead ────────────────────────────
console.log('Multi-word aliases resolve\n')

yes(RACK, q(['garment'], ['rack']), '"garment rack" finds the rolling wardrobe rack')
yes(RACK, q(['clothing'], ['rack']), '"clothing rack" too')
yes(DIGITAL, q(['walkie'], ['talkie']), '"walkie talkie" finds the digital radio')
yes(LINERS, q(['trash'], ['can'], ['liner']), '"trash can liner" finds the liners')

// ── Wes's walkie ruling ──────────────────────────────────────────────
console.log('\nA bare walkie is the digital one\n')

yes(DIGITAL, q(['walkie']), '"walkie" answers to digital')
no(ANALOG, q(['walkie']), '"walkie" does NOT drag in the analog radio')
yes(ANALOG, q(['analog'], ['walkie']), '"analog walkie" does reach analog')
no(DIGITAL, q(['analog'], ['walkie']), '"analog walkie" is not the digital row')

// ── Query must cover the alias, alias must cover the query ───────────
console.log('\nCoverage runs both directions\n')

no(RACK, q(['garment']), 'half a multi-word alias is not a match')
no(RACK, q(['garment'], ['rack'], ['blue']), 'an unmatched extra token disqualifies the row')
no(LINERS, q(['liner'], ['bag']), 'words from two different aliases do not combine')
yes(LINERS, q(['trash'], ['bag']), '"trash bag" is itself an alias')

// ── Degenerate input ─────────────────────────────────────────────────
console.log('\nDegenerate input is a miss, never a throw\n')

no([], q(['walkie']), 'a row with no aliases never matches')
no(DIGITAL, q(), 'an empty query never matches')
no([''], q(['walkie']), 'a blank alias is not a wildcard')

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All alias-matching checks passed.')
