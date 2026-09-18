/**
 * The counsel review link (2026-09-18 — Wes: "I'll need to send my finished
 * one to him … he can review it there with a button that allows him to
 * download a DOCX file").
 *
 * Two things are worth a test here and both are failure modes that would be
 * silent in production:
 *
 *  1. **Token separation.** Three schemes now sign JSON with NEXTAUTH_SECRET
 *     (COI upload, COI broker review, this). Without the domain separator a
 *     payload satisfying another reader's shape verifies — so a COI drop
 *     link handed to a stranger could open a contract, or the reverse. The
 *     cross-replay assertions below are the point of this file.
 *  2. **The Word file.** It exists because the copy Marell returned was a
 *     PDF→Word conversion carrying ten invented hyphens and no front matter.
 *     If the composed file ever loses the front matter, or gains a
 *     conversion-style hyphen, it has stopped solving the problem it was
 *     built for.
 *
 * Run: npm run test:counsel-review
 */
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-counsel-review'

import PizZip from 'pizzip'
import {
  signCounselReviewToken,
  verifyCounselReviewToken,
  counselReviewUrl,
} from '@/lib/contracts/counselReviewToken'
import { signCoiBrokerToken, verifyCoiBrokerToken } from '@/lib/coi/brokerReviewToken'
import {
  generateNegotiatedAgreementDocx,
  negotiatedDocumentXml,
  negotiatedDocxFilename,
} from '@/lib/contracts/generateNegotiatedAgreementDocx'
import { GRADUATION_DAY_2026 as AGREEMENT } from '@/lib/contracts/negotiatedAgreement'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const yes = (label: string, cond: boolean) => eq(label, cond, true)

// ── 1. The token ─────────────────────────────────────────────────────────
const ID = 'ca-1234-5678'
const token = signCounselReviewToken({ companyAgreementId: ID })
eq('a signed token round-trips', verifyCounselReviewToken(token)?.companyAgreementId, ID)
eq('garbage does not verify', verifyCounselReviewToken('nonsense'), null)
eq('empty does not verify', verifyCounselReviewToken(''), null)
eq('null does not verify', verifyCounselReviewToken(null), null)
// Flip a character in the payload half — the mac must reject it.
const [head, sig] = token.split('.')
eq('a tampered payload does not verify', verifyCounselReviewToken(`${head}x.${sig}`), null)
eq('a tampered signature does not verify', verifyCounselReviewToken(`${head}.${sig.slice(0, -2)}xy`), null)
eq('an expired token does not verify', verifyCounselReviewToken(signCounselReviewToken({ companyAgreementId: ID }, -1000)), null)

// THE assertion this file exists for: the two schemes must not accept each
// other's tokens, even though both sign JSON with the same secret.
const brokerToken = signCoiBrokerToken({ coiId: ID })
eq('a COI broker token is NOT a counsel token', verifyCounselReviewToken(brokerToken), null)
eq('a counsel token is NOT a COI broker token', verifyCoiBrokerToken(token), null)

// One id, so a forwarded link cannot widen.
yes('the payload carries exactly the agreement id and an expiry', (() => {
  const p = verifyCounselReviewToken(token)!
  return Object.keys(p).sort().join(',') === 'companyAgreementId,exp'
})())
yes('the url is absolute — it goes in an email', /^https?:\/\/.+\/agreement\/review\//.test(counselReviewUrl(token)))

// ── 2. The Word file ─────────────────────────────────────────────────────
const COMPANY = 'Graduation Day Productions'
const xml = negotiatedDocumentXml({ agreement: AGREEMENT, companyName: COMPANY, generatedAt: new Date('2026-09-18T12:00:00Z') })
/** The visible text, with XML entities turned back into characters — clause
 *  6's title carries an "&" and clause bodies carry quotes, so a comparison
 *  against the source strings has to undo the escaping the document needs. */
const text = (xml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
  .map((m) => m.replace(/<[^>]+>/g, ''))
  .join(' ')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&')

// The front matter the converted file lost.
for (const probe of [
  'SirReel Studio Services',
  '8500 Lankershim',
  AGREEMENT.title,
  AGREEMENT.version,
  `Lessee: ${COMPANY}`,
  'Lessor: SirReel Production Vehicles',
  'Prepared:',
]) {
  yes(`front matter carries "${probe.slice(0, 32)}"`, text.includes(probe))
}
yes('the lede is there', text.includes('Please read carefully'))

// Every clause of theirs, verbatim, and every appended one.
const missing = AGREEMENT.clauses.filter((c) => !text.includes(c.body.slice(0, 60)))
eq('every client clause reaches the Word file', missing.map((c) => c.ref), [])
const missingHeads = AGREEMENT.clauses.filter((c) => !text.includes(`${c.ref}. ${c.title}`))
eq('every clause keeps its own number and title', missingHeads.map((c) => c.ref), [])
yes('the appended clause is there', text.includes(AGREEMENT.appendedClauses[0].body.slice(0, 60)))
yes('at its number in THEIR sequence', text.includes(`${AGREEMENT.appendedClauses[0].ref}. `))
// Their numbering has a deliberate GAP at 15 (counsel deleted Subrogation).
// Word auto-numbering would close it, which is why headings are literal text.
yes('the deliberate gap at 15 survives', !text.includes('15. ') && text.includes('14. ') && text.includes('16. '))

// Ours must read as ours.
yes('additions sit under their own heading', text.includes('Additional Terms'))
yes('and say they are additions', text.includes('added by SirReel'))
yes('the Fleet Agreement rides along', text.includes(AGREEMENT.appendedClauses.length ? 'Fleet' : 'Fleet'))
yes('the LCDW addendum rides along', text.includes('Limited Collision Damage Waiver'))
yes('this copy is unsigned — it is for review', text.includes('Signature of Authorized Representative'))

// The defects that started this feature.
const ARTIFACTS = ['compen-sation', 'inde-pendent', 'cover-age', 'compre-hensive', 'insur-ance', 're-duced', 'Agree-ment', 'con-strued', 'arbitra-tion', 'circum-stances']
eq('no PDF→Word hyphen artifacts', ARTIFACTS.filter((w) => text.includes(w)), [])
yes('the REAL hyphen in "non-payment" survives', text.includes('non-payment'))

// XML hygiene — an unescaped ampersand in a clause body corrupts the file,
// and their clause 14 title carries a slash while several bodies carry
// quotes and curly punctuation.
yes('ampersands are escaped', !/&(?!amp;|lt;|gt;|quot;|#)/.test(xml))

// It is a real package Word will open.
const buf = generateNegotiatedAgreementDocx({ agreement: AGREEMENT, companyName: COMPANY })
const zip = new PizZip(buf)
for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels']) {
  yes(`the package contains ${part}`, !!zip.file(part))
}
yes('the buffer is a plausible size', buf.length > 5000 && buf.length < 2_000_000)
yes('the filename names the document and the company', negotiatedDocxFilename(AGREEMENT, COMPANY).endsWith('Graduation-Day-Productions.docx'))
yes('the filename carries no comma or separator', !/[,/\\]/.test(negotiatedDocxFilename(AGREEMENT, 'Party Giraffes, LLC')))

if (fail) { console.error(`\n${fail} failing`); process.exit(1) }
console.log('\nall good')
