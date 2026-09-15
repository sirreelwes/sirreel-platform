/**
 * Guards the negotiated-agreement render.
 *
 * Run: npx tsx tests/contracts/negotiated-agreement.test.ts
 *
 * What this protects is unusual for this codebase: the clause text is ANOTHER
 * LAWYER'S, agreed after a negotiation, and a word changed here is a term
 * renegotiated without telling anyone. So the central assertion is that every
 * clause reaches the PDF byte-for-byte, and the rest guards the three ways
 * that could silently stop being true — a lost clause, a renumbering that
 * makes the appended clause cite the wrong sections, and the appendix
 * colliding with the client's own numbering.
 */
import { createHash } from 'crypto'
import { PDFParse } from 'pdf-parse'
import { generateNegotiatedAgreementPdf } from '../../src/lib/contracts/generateNegotiatedAgreementPdf'
import {
  GRADUATION_DAY_2026,
  crossReferencesHold,
  nextFreeRef,
  APPENDED_SECTIONS,
} from '../../src/lib/contracts/negotiatedAgreement'

const failures: string[] = []
const check = (cond: unknown, msg: string) => {
  if (!cond) failures.push(msg)
}

/**
 * The transcription, pinned.
 *
 * On 2026-09-15 the stored clause text was verified word-for-word against
 * SirReel_Redlined_RentalAgreement_2026.pdf — the client's own file — using a
 * SECOND, independent extraction (`pdftotext -raw`, a different reconstruction
 * path from the `-layout` output it was parsed from). All 2,836 words of the
 * contract portion matched in order, with no substantive difference.
 *
 * Two artifacts, both resolved and neither a contract word:
 *  - "non-payment" in clause 21 wraps across a line. The whole five-page
 *    justified document contains exactly ONE line-break hyphen, so
 *    auto-hyphenation is off and the hyphen is the author's. Kept.
 *  - Clauses 22, 23 and 24 print "Title. Body" on one line, so their title
 *    token carries a trailing period. Titles are a separate element here, as
 *    they are for every other clause.
 *
 * The client's PDF is not in the repo, so that comparison cannot re-run in
 * CI. This digest stands in for it: any edit to the clause text changes it,
 * and re-verification against the client's file is then required before the
 * value below is updated. Do not update it to make a red test green.
 */
const VERIFIED_CLAUSE_DIGEST = '67f0e1e3a90ca08904204b43a134a9d19763070ab3fa5aa0111742419831a282'
const VERIFIED_WORD_COUNT = 2776

/**
 * Layout wrapping and pdftotext-style hyphenation are extraction artifacts,
 * not content, so whitespace and hyphens are squashed before comparing.
 * Everything else — every word, in order — must match.
 */
const squash = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[\s\-]+/g, '')
    .toLowerCase()

async function main() {
  const a = GRADUATION_DAY_2026

  // 0. The text is still the text that was verified against the client's PDF.
  const joined = a.clauses.map((c) => `${c.ref}|${c.title}|${c.body}`).join('\n')
  const digest = createHash('sha256').update(joined, 'utf8').digest('hex')
  check(
    digest === VERIFIED_CLAUSE_DIGEST,
    `negotiated clause text has changed since it was verified against the client's PDF.\n` +
      `      expected ${VERIFIED_CLAUSE_DIGEST}\n      got      ${digest}\n` +
      `      Re-verify against SirReel_Redlined_RentalAgreement_2026.pdf before updating this digest.`,
  )
  check(
    joined.split(/\s+/).filter(Boolean).length === VERIFIED_WORD_COUNT,
    `negotiated clause word count changed (expected ${VERIFIED_WORD_COUNT})`,
  )

  // 1. The client's clauses, and the deliberate gap where 15 was.
  check(a.clauses.length === 30, `expected 30 negotiated clauses, got ${a.clauses.length}`)
  check(!a.clauses.some((c) => c.ref === '15'), 'clause 15 (Subrogation) must stay deleted — it is their redline')
  check(a.clauses.some((c) => c.ref === '22' && /Rights in Recordings/i.test(c.title)), 'clause 22 (theirs) missing')
  check(a.clauses.some((c) => c.ref === '23' && /Injunctive/i.test(c.title)), 'clause 23 (theirs) missing')

  // 2. The appendix must not collide with their numbering. Their 30 is
  //    Facsimile Signature and their 31 is Non-smoking, so ours starts at 32.
  const free = nextFreeRef(a.clauses)
  check(free === '32', `next free ref should be 32 in their numbering, got ${free}`)
  for (const added of a.appendedClauses) {
    check(
      !a.clauses.some((c) => c.ref === added.ref),
      `appended clause ${added.ref} collides with a client clause — renumbering theirs is never an option`,
    )
  }

  // 3. The appended clause cites sections by number. If their numbering ever
  //    stops matching ours, it would point at the wrong terms.
  const xref = crossReferencesHold(a.clauses)
  check(xref.ok, `cross-references broken: ${xref.mismatched.map((m) => `${m.ref} ours="${m.ours}" theirs="${m.theirs}"`).join('; ')}`)

  // 4. Every clause reaches the rendered PDF verbatim.
  const buf = await generateNegotiatedAgreementPdf({
    agreement: a,
    companyName: 'Graduation Day Productions',
    generatedAt: new Date('2026-09-15T12:00:00Z'),
  })
  const parsed = await new PDFParse({ data: new Uint8Array(buf) }).getText()
  const flat = squash(parsed.text)

  const missing = a.clauses.filter((c) => !flat.includes(squash(c.body))).map((c) => c.ref)
  check(missing.length === 0, `clause bodies missing or altered in the render: ${missing.join(', ')}`)

  const titlesMissing = a.clauses.filter((c) => !flat.includes(squash(c.title))).map((c) => c.ref)
  check(titlesMissing.length === 0, `clause titles missing from the render: ${titlesMissing.join(', ')}`)

  // 5. The three sections their document does not have.
  for (const [probe, label] of [
    [APPENDED_SECTIONS.FLEET_AGREEMENT.title, 'Fleet Agreement section'],
    [APPENDED_SECTIONS.FLEET_AGREEMENT.fuelPolicy, 'fuel policy'],
    [APPENDED_SECTIONS.LCDW_ADDENDUM.title, 'LCDW addendum'],
    [APPENDED_SECTIONS.LCDW_ADDENDUM.exclusions, 'LCDW exclusions (incl. overhead clearance)'],
    [a.appendedClauses[0].body, 'Third-Party Equipment body'],
  ] as const) {
    check(flat.includes(squash(probe)), `${label} missing from the render`)
  }

  // 6. Additions are visibly additions, and the paper is ours.
  check(flat.includes(squash('Additional Terms')), 'additions must sit under their own heading')
  check(flat.includes(squash('added by SirReel')), 'appended clauses must be marked as added by SirReel')
  check(flat.includes(squash('SirReel Studio Services')), 'document must be branded SirReel Studio Services')
  check(flat.includes(squash('8500 Lankershim')), 'masthead contact line missing')

  // 7. It is a settled agreement, not a proposal.
  check(!flat.includes(squash('Counter Proposal')), 'a filed master must not call itself a counter proposal')

  if (failures.length) {
    console.error(`\n${failures.length} assertion(s) failed:`)
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log(
    `✓ negotiated agreement: ${a.clauses.length} client clauses verbatim + ${a.appendedClauses.length} appended, Fleet + LCDW present (${buf.length} bytes, ${parsed.pages?.length ?? '?'} pages).`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
