#!/usr/bin/env tsx
/**
 * Regenerates public/contracts/sirreel-rental-agreement.pdf from the canonical
 * clause text in src/lib/contracts/contractClauses.ts.
 *
 * WHY THIS EXISTS. That PDF is not decoration and it is not the client's copy.
 * runReview.ts loads it as the BASELINE the AI diffs a client's redlined upload
 * against (src/lib/contracts/runReview.ts, STANDARD_AGREEMENT_PATH). If the
 * clause source moves and the PDF doesn't, the review reads SirReel's own new
 * clause as the client's edit and flags it for negotiation — a silent failure
 * that looks like a client redline.
 *
 * The client-facing download does NOT need this: /api/public/rental-agreement/pdf
 * re-renders from the clause array on every request. Same renderer, same
 * arguments as that route, so the baseline and what the client downloads are
 * byte-for-byte the same document.
 *
 * Run after ANY edit to contractClauses.ts:
 *   npx tsx scripts/generate-canonical-agreement-pdf.ts
 *
 * Writes in place. The previous file is kept alongside as
 * sirreel-rental-agreement.pdf.bak.<timestamp> (gitignored) so a bad render is
 * recoverable without going to git.
 */

import { writeFileSync, copyFileSync, existsSync, statSync } from 'fs'
import path from 'path'
import { generateCounterPdf } from '../src/lib/contracts/generateCounterPdf'
import { CANONICAL_CLAUSES } from '../src/lib/contracts/contractClauses'

const OUT_PATH = path.join(process.cwd(), 'public', 'contracts', 'sirreel-rental-agreement.pdf')

async function main() {
  const refs = CANONICAL_CLAUSES.map((c) => c.ref)
  console.log(`Rendering ${refs.length} clauses (${refs[0]}–${refs[refs.length - 1]}) …`)

  if (existsSync(OUT_PATH)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = `${OUT_PATH}.bak.${stamp}`
    copyFileSync(OUT_PATH, backup)
    console.log(`Previous copy kept at ${path.basename(backup)} (${statSync(backup).size} bytes)`)
  }

  const pdf = await generateCounterPdf({
    company: null,
    job: null,
    aiChanges: [],
    decisions: [],
    generatedAt: new Date(),
    grantedScope: null,
    // Baseline document — NOT a counter proposal. Matches
    // src/app/api/public/rental-agreement/pdf/route.ts exactly.
    documentTitle: 'Rental Agreement',
  })

  writeFileSync(OUT_PATH, pdf)
  console.log(`Wrote ${OUT_PATH} (${pdf.length} bytes)`)
}

main().catch((err) => {
  console.error('Render failed — the existing PDF was NOT replaced.', err)
  process.exit(1)
})
