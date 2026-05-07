/**
 * Regression fixture for the counter-PDF generator.
 *
 * Run: npx tsx tests/contract-review/counter-pdf.test.ts
 *
 * Renders the contract via @react-pdf/renderer, extracts text via pdf-parse,
 * and asserts on substance (company info, decision-specific clause text).
 * The extracted text is also snapshotted so unintended changes are caught.
 *
 * When the contract template substance changes legitimately, re-run with
 * UPDATE_SNAPSHOTS=1 to regenerate.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { PDFParse } from 'pdf-parse'
import { generateCounterPdf } from '../../src/lib/contracts/generateCounterPdf'
import { CANONICAL_CLAUSES } from '../../src/lib/contracts/contractClauses'

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'fixture-known-redline.json')
const SNAPSHOT_DIR = path.join(__dirname, '__snapshots__')
const SNAPSHOT_PATH = path.join(SNAPSHOT_DIR, 'fixture-known-redline.txt')

interface Fixture {
  name: string
  description: string
  company: any
  job: any
  aiChanges: any[]
  decisions: any[]
}

const failures: string[] = []

function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message)
}

function checkContains(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) {
    failures.push(`${label}: expected to contain "${needle.slice(0, 80)}"`)
  }
}

function checkNotContains(haystack: string, needle: string, label: string): void {
  if (haystack.includes(needle)) {
    failures.push(`${label}: expected NOT to contain "${needle.slice(0, 80)}"`)
  }
}

// pdf-parse may insert linebreaks/hyphenation between glyphs; collapse all
// whitespace runs to a single space before substring matching.
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

async function extractText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  const result = await parser.getText()
  return result.text
}

async function main() {
  const fixture: Fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))

  const job = {
    ...fixture.job,
    startDate: fixture.job?.startDate ? new Date(fixture.job.startDate) : null,
    endDate: fixture.job?.endDate ? new Date(fixture.job.endDate) : null,
    primaryContact: {
      fullName: 'Jane Doe',
      role: 'PM',
      email: 'jane@mockingbirdprods.com',
      phone: '+1 310 555 0142',
    },
  }

  const buffer = await generateCounterPdf({
    company: fixture.company,
    job,
    aiChanges: fixture.aiChanges,
    decisions: fixture.decisions,
    generatedAt: new Date('2026-05-08T00:00:00Z'),
  })

  check(buffer.length > 5000, `PDF buffer should be non-trivial (got ${buffer.length} bytes)`)

  const rawText = await extractText(buffer)
  const text = normalize(rawText)

  // 1. Document scaffolding present.
  checkContains(text, 'SirReel', 'brand block')
  checkContains(text, 'Counter Proposal', 'doc title')

  // 2. Company + job blocks render with fixture data.
  checkContains(text, 'Mockingbird Productions LLC', 'company name')
  checkContains(text, 'SR-JOB-9999', 'job code')
  checkContains(text, 'Pilot Episode', 'job name')

  // 3. Primary contact block.
  checkContains(text, 'Jane Doe', 'primary contact name')
  checkContains(text, 'jane@mockingbirdprods.com', 'primary contact email')

  // 4. All 29 canonical clause titles present.
  for (const c of CANONICAL_CLAUSES) {
    checkContains(text, c.title, `clause ${c.ref} title`)
  }

  // 5. Decision-specific behavior.

  // Clause 1 + 14 are REJECT → canonical text retained.
  checkContains(
    text,
    'agree to defend, indemnify',
    'clause 1 (REJECT) keeps canonical indemnity language'
  )
  checkContains(
    text,
    'WE WILL, IN NO EVENT, BE LIABLE FOR ANY CONSEQUENTIAL',
    'clause 14 (REJECT) keeps canonical liability cap'
  )

  // Clause 19 ACCEPT → renders AI's `proposed` text.
  checkContains(
    text,
    'subject to reasonable wear and tear',
    'clause 19 (ACCEPT) renders AI proposed text'
  )

  // Clause 6 COUNTER → renders human counterLanguage, not the AI proposed text.
  checkContains(
    text,
    'workers compensation/employers liability insurance with minimum limits of $1,000,000',
    'clause 6 (COUNTER) renders counterLanguage'
  )
  checkNotContains(text, 'statutory limits only', 'clause 6 does not show AI proposed text')

  // Clause 29 ACCEPT.
  checkContains(text, 'Adjust smoking violation fee to $200/day', 'clause 29 ACCEPT renders proposed')

  // 6. Fleet + LCDW sections rendered.
  checkContains(text, 'Fleet Agreement', 'Fleet section heading')
  checkContains(text, 'Limited Collision Damage Waiver', 'LCDW section heading')

  // 7. No signature block per Phase 4a/4a.5 design decision.
  checkNotContains(text, 'Signature:', 'no signature label')
  checkNotContains(text, 'Authorized Signatory', 'no signatory block')

  // 8. Decision tags present in text. Tags are uppercased via textTransform.
  checkContains(text, 'ACCEPTED', 'ACCEPT decision tag rendered')
  checkContains(text, 'COUNTERED', 'COUNTER decision tag rendered')
  checkContains(text, 'ORIGINAL RETAINED', 'REJECT decision tag rendered')

  // 9. Snapshot — write on first run, compare on later runs.
  mkdirSync(SNAPSHOT_DIR, { recursive: true })
  let snapshotResult: 'wrote' | 'matched' | 'mismatch' = 'matched'
  try {
    const prior = readFileSync(SNAPSHOT_PATH, 'utf-8')
    if (prior !== rawText) {
      snapshotResult = 'mismatch'
      if (process.env.UPDATE_SNAPSHOTS === '1') {
        writeFileSync(SNAPSHOT_PATH, rawText)
        snapshotResult = 'wrote'
      } else {
        failures.push(
          `Snapshot mismatch at ${SNAPSHOT_PATH}. Re-run with UPDATE_SNAPSHOTS=1 if intentional.`
        )
      }
    }
  } catch {
    writeFileSync(SNAPSHOT_PATH, rawText)
    snapshotResult = 'wrote'
  }

  console.log(`Snapshot: ${snapshotResult}`)

  if (failures.length > 0) {
    console.error(`\n${failures.length} assertion(s) failed:`)
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }

  console.log(
    `\n✓ counter-PDF fixture passed (${CANONICAL_CLAUSES.length} clauses + ${fixture.decisions.length} decisions; ${buffer.length} bytes).`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
