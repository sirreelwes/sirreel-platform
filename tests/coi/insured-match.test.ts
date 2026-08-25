/**
 * Named-insured matcher tests — does the COI cover the production we papered?
 *
 *   npx tsx tests/coi/insured-match.test.ts
 *   npm run test:insured-match
 *
 * Pure + offline: no DB, no AI, no env. The matcher decides what a human is
 * TOLD (and what the client is told on their portal), so the cases that
 * matter are the two failure directions — a false MISMATCH cries wolf at a
 * client whose paperwork is fine, and a missed MISMATCH lets an agreement go
 * out against an entity nobody insured.
 *
 * Fixtures are real shapes seen in the book (entity suffixes, dba lines, a
 * "TBD" production name, our own certificate filed against a client job),
 * with company names changed where they are not already ours.
 */

import { evaluateInsuredMatch, type InsuredMatchVerdict } from '../../src/lib/coi/insuredMatch'

const failures: string[] = []

function check(
  namedInsured: string | null,
  candidates: string[],
  want: InsuredMatchVerdict,
  why: string,
): void {
  const got = evaluateInsuredMatch(namedInsured, candidates)
  if (got.verdict === want) {
    console.log(`  ok — ${why}`)
  } else {
    failures.push(`${why}: ${JSON.stringify(namedInsured)} vs ${JSON.stringify(candidates)} → ${got.verdict}, wanted ${want}`)
  }
}

console.log('Named insured vs production company\n')

// Same entity, different punctuation / legal form. These MUST NOT alarm —
// almost every real certificate differs from our company record this way.
check('Acme Films, LLC', ['Acme Films LLC'], 'MATCH', 'punctuation only')
check('Acme Films, LLC', ['Acme Films'], 'MATCH', 'entity suffix dropped on our side')
check('JAP Productions Inc.', ['JAP Productions'], 'MATCH', 'suffix on the certificate only')
check('Music Therapy S1 LLC', ['Music Therapy S1'], 'MATCH', 'production name carries the season')
check('Acme Films LLC dba Acme Pictures', ['Acme Pictures'], 'MATCH', 'dba half matches')

// Genuinely different entities. These MUST alarm.
check('Contrast Films, LLC', ['JAP Productions', 'Untitled Feature'], 'MISMATCH', 'different company')
check('Zenith Productions', ['Acme Productions'], 'MISMATCH', '"Productions" alone proves nothing')

// Our own certificate filed against a client's job — insures SirReel, so it
// says nothing about the client's coverage.
check('SirReel Production Vehicles Inc.', ['JAP Productions'], 'MISMATCH', 'our cert, not theirs')

// Wording differs but it is plainly the same outfit — worth showing, not
// worth alarming about.
check('Acme Films Production Services', ['Acme Films'], 'CLOSE', 'one name contains the other')

// Nothing to compare against.
check(null, ['JAP Productions'], 'UNKNOWN', 'no named insured extracted')
check('Contrast Films, LLC', ['TBD'], 'PLACEHOLDER', 'production company never filled in')
check('Contrast Films, LLC', [''], 'PLACEHOLDER', 'no production company at all')

// A MISMATCH must carry a client-safe sentence; everything else must not
// (the portal renders whatever it is handed).
const mismatch = evaluateInsuredMatch('Contrast Films, LLC', ['JAP Productions'])
if (mismatch.clientMessage.includes('Contrast Films') && mismatch.clientMessage.includes('JAP Productions')) {
  console.log('  ok — mismatch tells the client both names')
} else {
  failures.push('mismatch clientMessage should name the certificate and the job company')
}
const matched = evaluateInsuredMatch('Acme Films, LLC', ['Acme Films'])
if (matched.clientMessage === '') {
  console.log('  ok — a match says nothing to the client')
} else {
  failures.push('a MATCH must not produce client-facing copy')
}

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All named-insured matcher checks passed.')
