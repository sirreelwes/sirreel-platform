/**
 * Regression fixture for the counter-PDF generator.
 *
 * Run: npx tsx tests/contract-review/counter-pdf.test.ts
 *
 * Asserts on the rendered HTML (not the binary PDF — pixel diffing is too
 * brittle for v1). When the contract template substance changes
 * legitimately, update the assertions and snapshot.
 *
 * The fixture lives at scripts/contract-review-fixtures/fixture-known-redline.json.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { renderContractHtml } from '../../src/lib/contracts/contractTemplate'
import { CANONICAL_CLAUSES } from '../../src/lib/contracts/contractClauses'

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'fixture-known-redline.json')
const SNAPSHOT_DIR = path.join(__dirname, '__snapshots__')
const SNAPSHOT_PATH = path.join(SNAPSHOT_DIR, 'fixture-known-redline.html')

interface Fixture {
  name: string
  description: string
  company: any
  job: any
  aiChanges: any[]
  decisions: any[]
}

interface Failure {
  message: string
}

const failures: Failure[] = []

function check(condition: unknown, message: string): void {
  if (!condition) failures.push({ message })
}

function checkContains(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) {
    failures.push({ message: `${label}: expected to contain "${needle.slice(0, 80)}"` })
  }
}

function checkNotContains(haystack: string, needle: string, label: string): void {
  if (haystack.includes(needle)) {
    failures.push({ message: `${label}: expected NOT to contain "${needle.slice(0, 80)}"` })
  }
}

function main() {
  const fixture: Fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))

  // Coerce ISO date strings into Date objects to match runtime input shape.
  const job = {
    ...fixture.job,
    startDate: fixture.job?.startDate ? new Date(fixture.job.startDate) : null,
    endDate: fixture.job?.endDate ? new Date(fixture.job.endDate) : null,
  }

  const html = renderContractHtml({
    company: fixture.company,
    job,
    aiChanges: fixture.aiChanges,
    decisions: fixture.decisions,
    generatedAt: new Date('2026-05-08T00:00:00Z'),
  })

  // 1. Document scaffolding present.
  check(html.startsWith('<!DOCTYPE html>'), 'output starts with doctype')
  checkContains(html, 'SirReel Studio Rentals', 'brand block')
  checkContains(html, 'Counter Proposal', 'doc title')

  // 2. Company + job blocks render with fixture data.
  checkContains(html, 'Mockingbird Productions LLC', 'company name')
  checkContains(html, 'SR-JOB-9999', 'job code')
  checkContains(html, 'Pilot Episode', 'job name')

  // 3. All 29 canonical clauses present.
  const escapeForHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  for (const c of CANONICAL_CLAUSES) {
    checkContains(html, `data-clause-ref="${c.ref}"`, `clause ${c.ref} block`)
    checkContains(html, escapeForHtml(c.title), `clause ${c.ref} title`)
  }

  // 4. Decision-specific behavior.

  // Clause 1 + 14 are REJECT → canonical text retained.
  checkContains(
    html,
    'Lessee/Renter (&quot;You&quot;) agree to defend, indemnify',
    'clause 1 (REJECT) keeps canonical indemnity language'
  )
  checkContains(
    html,
    'WE WILL, IN NO EVENT, BE LIABLE FOR ANY CONSEQUENTIAL',
    'clause 14 (REJECT) keeps canonical liability cap'
  )
  checkContains(
    html,
    'data-clause-ref="1" data-decision="REJECT"',
    'clause 1 tagged REJECT'
  )

  // Clause 19 ACCEPT → renders AI's `proposed` text.
  checkContains(
    html,
    'subject to reasonable wear and tear',
    'clause 19 (ACCEPT) renders AI proposed text'
  )
  checkContains(
    html,
    'data-clause-ref="19" data-decision="ACCEPT"',
    'clause 19 tagged ACCEPT'
  )

  // Clause 6 COUNTER → renders human counterLanguage, not canonical and not proposed.
  checkContains(
    html,
    'Lessee shall maintain workers compensation/employers liability insurance with minimum limits of $1,000,000',
    'clause 6 (COUNTER) renders counterLanguage'
  )
  checkContains(
    html,
    'data-clause-ref="6" data-decision="COUNTER"',
    'clause 6 tagged COUNTER'
  )
  // The original AI proposal (statutory limits) must NOT leak into output.
  checkNotContains(html, 'statutory limits only', 'clause 6 does not show AI proposed text')

  // Clause 29 ACCEPT.
  checkContains(html, 'Adjust smoking violation fee to $200/day', 'clause 29 ACCEPT renders proposed')

  // 5. Fleet + LCDW sections rendered.
  checkContains(html, 'Fleet Agreement', 'Fleet section heading')
  checkContains(html, 'Limited Collision Damage Waiver', 'LCDW section heading')

  // 6. None of the *decided* clauses should render as PENDING in the output.
  //    Clauses with no decision at all default to PENDING data-attr — that is
  //    correct behavior (they render as canonical).
  for (const d of fixture.decisions) {
    const tag = `data-clause-ref="${d.clauseRef}" data-decision="PENDING"`
    checkNotContains(html, tag, `decided clause ${d.clauseRef} must not render as PENDING`)
  }

  // 7. Snapshot — write on first run, compare on later runs.
  mkdirSync(SNAPSHOT_DIR, { recursive: true })
  let snapshotResult: 'wrote' | 'matched' | 'mismatch' = 'matched'
  try {
    const prior = readFileSync(SNAPSHOT_PATH, 'utf-8')
    if (prior !== html) {
      snapshotResult = 'mismatch'
      if (process.env.UPDATE_SNAPSHOTS === '1') {
        writeFileSync(SNAPSHOT_PATH, html)
        snapshotResult = 'wrote'
      } else {
        failures.push({
          message: `Snapshot mismatch at ${SNAPSHOT_PATH}. Re-run with UPDATE_SNAPSHOTS=1 if intentional.`,
        })
      }
    }
  } catch {
    writeFileSync(SNAPSHOT_PATH, html)
    snapshotResult = 'wrote'
  }

  console.log(`Snapshot: ${snapshotResult}`)

  if (failures.length > 0) {
    console.error(`\n${failures.length} assertion(s) failed:`)
    for (const f of failures) console.error(`  - ${f.message}`)
    process.exit(1)
  }

  console.log(`\n✓ counter-PDF fixture passed (${CANONICAL_CLAUSES.length} clauses + ${fixture.decisions.length} decisions).`)
}

main()
