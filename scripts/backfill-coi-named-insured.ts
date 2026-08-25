#!/usr/bin/env tsx
/**
 * One-time backfill — re-run the COI AI review on certificates whose STORED
 * review predates the `namedInsured` field.
 *
 * Why it is needed: the insured-name match is computed from the persisted
 * `namedInsured` column. Every review filed before that field was added to
 * the prompt has no insured name in it at all, so those certificates read
 * UNKNOWN in the review modal until the document is looked at again. New
 * uploads extract it on the first pass; this is only for the backlog.
 *
 * Safety: SELECTS first and captures ids, then updates BY CAPTURED ID only.
 * Never deletes. Re-running is harmless — rows that already carry a name are
 * skipped, so a partial run can just be run again.
 *
 * Needs production env for private-blob reads (no BLOB token locally):
 *   vercel env run -e production -- npx tsx scripts/backfill-coi-named-insured.ts
 *   vercel env run -e production -- npx tsx scripts/backfill-coi-named-insured.ts --write
 *
 * Without --write it is a dry run: it lists what it would touch and stops.
 */
import { prisma } from '@/lib/prisma'
import { rerunCoiAiReview } from '@/lib/coi/rerunCoiReview'
import { evaluateInsuredMatch } from '@/lib/coi/insuredMatch'

const WRITE = process.argv.includes('--write')

async function main() {
  const candidates = await prisma.coiCheck.findMany({
    where: { deletedAt: null, namedInsured: null, jobId: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      originalFilename: true,
      createdAt: true,
      job: { select: { name: true, jobCode: true, company: { select: { name: true } } } },
    },
  })

  console.log(`${candidates.length} certificate(s) attached to a job with no insured name on file.\n`)
  if (candidates.length === 0) return

  for (const c of candidates) {
    console.log(
      `  ${c.createdAt.toISOString().slice(0, 10)}  ${(c.originalFilename || '—').slice(0, 34).padEnd(34)}  ` +
        `${c.job?.jobCode ?? '—'}  ${c.job?.company?.name ?? '(no company on job)'}`,
    )
  }

  if (!WRITE) {
    console.log('\nDry run — nothing written. Re-run with --write to apply.')
    return
  }

  console.log('\nRunning reviews…\n')
  let named = 0
  let blank = 0
  const failed: Array<{ id: string; file: string; error: string }> = []

  for (const c of candidates) {
    // By captured id — never by pattern or shape.
    const outcome = await rerunCoiAiReview(c.id)
    const file = (c.originalFilename || c.id).slice(0, 34)
    if (!outcome.ok) {
      failed.push({ id: c.id, file, error: outcome.error })
      console.log(`  ✗ ${file.padEnd(34)}  ${outcome.error}`)
      continue
    }
    if (!outcome.namedInsured) {
      blank++
      console.log(`  · ${file.padEnd(34)}  no insured name found on the document`)
      continue
    }
    named++
    const match = evaluateInsuredMatch(outcome.namedInsured, [
      c.job?.company?.name,
      c.job?.name,
    ])
    const flag = match.needsAttention ? '  ⚠ MISMATCH' : ''
    console.log(`  ✓ ${file.padEnd(34)}  insures "${outcome.namedInsured}"  [${match.verdict}]${flag}`)
  }

  console.log(
    `\nDone. ${named} got an insured name, ${blank} had none on the document, ${failed.length} failed.`,
  )
  if (failed.length) {
    console.log('Failed ids (left untouched):')
    for (const f of failed) console.log(`  ${f.id}  ${f.file}  ${f.error}`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
