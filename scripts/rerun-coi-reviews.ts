#!/usr/bin/env tsx
/**
 * Re-run the COI AI review on stored certificates whose review predates the
 * unified checklist.
 *
 * Why: there used to be three COI prompts, and the one behind the review
 * desk was the thinnest of them — it never asked about Primary &
 * Non-Contributory, Waiver of Subrogation, Umbrella, Workers Comp, the
 * 30-day cancellation clause or contractor coverage, and it answered in one
 * prose paragraph instead of a per-check verdict. Every certificate reviewed
 * through it reads "passes the checks" on eight questions out of fifteen.
 * This asks the other seven.
 *
 * Safety: SELECTS first and captures ids, then updates BY CAPTURED ID only.
 * Never deletes. Never touches humanDecision or coverageVerified — a human
 * sign-off is not the AI's to revoke. Re-running is harmless: rows that
 * already carry a checklist are skipped unless --all is passed.
 *
 * Needs production env for private-blob reads (no BLOB token locally):
 *   vercel env run -e production -- npx tsx scripts/rerun-coi-reviews.ts
 *   vercel env run -e production -- npx tsx scripts/rerun-coi-reviews.ts --write
 *
 * Without --write it is a dry run: it lists what it would touch and stops.
 *   --all     re-run every certificate, including ones already on the checklist
 *   --limit N stop after N certificates (useful for a first cautious batch)
 */
import { prisma } from '@/lib/prisma'
import { rerunCoiAiReview } from '@/lib/coi/rerunCoiReview'
import { coiFlags, hasCoiChecklist } from '@/lib/coi/checks'
import type { CoiAiResponse } from '@/lib/coi/reviewCoi'

const WRITE = process.argv.includes('--write')
const ALL = process.argv.includes('--all')
const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity

async function main() {
  const rows = await prisma.coiCheck.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      originalFilename: true,
      createdAt: true,
      aiRiskLevel: true,
      aiResponse: true,
      humanDecision: true,
      job: { select: { jobCode: true, company: { select: { name: true } } } },
    },
  })

  // Capture the ids of exactly the rows this run may touch.
  const candidates = rows
    .filter((r) => ALL || !hasCoiChecklist(r.aiResponse as CoiAiResponse | null))
    .slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined)

  const already = rows.length - rows.filter((r) => !hasCoiChecklist(r.aiResponse as CoiAiResponse | null)).length
  console.log(
    `${rows.length} certificate(s) on file — ${already} already judged on the full checklist, ` +
      `${rows.length - already} on the old prompt.`,
  )
  console.log(`${candidates.length} selected for this run.\n`)
  if (candidates.length === 0) return

  for (const c of candidates) {
    console.log(
      `  ${c.createdAt.toISOString().slice(0, 10)}  ${(c.originalFilename || '—').slice(0, 40).padEnd(40)}  ` +
        `${(c.job?.jobCode ?? '—').padEnd(11)}  ${(c.aiRiskLevel ?? 'no review').padEnd(9)}  ${c.humanDecision}`,
    )
  }

  if (!WRITE) {
    console.log('\nDry run — nothing written. Re-run with --write to apply.')
    return
  }

  console.log('\nRunning reviews…\n')
  let changed = 0
  let clean = 0
  const failed: Array<{ id: string; file: string; error: string }> = []
  // Certificates a human already approved that the fuller checklist now
  // faults. Nothing is un-approved automatically — this is the list to read.
  const nowFailing: Array<{ id: string; file: string; job: string; open: string[]; approved: boolean }> = []

  for (const c of candidates) {
    // By captured id — never by pattern or shape.
    const outcome = await rerunCoiAiReview(c.id)
    const file = (c.originalFilename || c.id).slice(0, 40)
    if (!outcome.ok) {
      failed.push({ id: c.id, file, error: outcome.error })
      console.log(`  ✗ ${file.padEnd(40)}  ${outcome.error}`)
      continue
    }

    const after = await prisma.coiCheck.findUnique({ where: { id: c.id }, select: { aiResponse: true } })
    const flags = coiFlags(after?.aiResponse as CoiAiResponse | null)
    const open = [...flags.criticalOpen, ...flags.alertOpen].map((r) => r.label)

    if (!flags.criticalPass) {
      nowFailing.push({
        id: c.id,
        file,
        job: c.job?.jobCode ?? '—',
        open: flags.criticalOpen.map((r) => r.label),
        approved: c.humanDecision === 'APPROVED',
      })
    }

    const before = c.aiRiskLevel ?? 'none'
    if (before !== outcome.riskLevel) changed++
    else clean++

    const moved = before === outcome.riskLevel ? '' : `  ${before} → ${outcome.riskLevel}`
    console.log(
      `  ${flags.criticalPass ? '✓' : '⚠'} ${file.padEnd(40)}  ` +
        `${outcome.riskLevel.padEnd(6)}${moved.padEnd(18)}` +
        (open.length ? `  open: ${open.join(', ')}` : '  everything met'),
    )
  }

  console.log(`\nDone. ${changed} changed risk level, ${clean} unchanged, ${failed.length} failed.`)

  if (nowFailing.length) {
    console.log(`\n${nowFailing.length} certificate(s) now fail a REQUIRED check:`)
    for (const f of nowFailing) {
      console.log(
        `  ${f.approved ? 'APPROVED BY A HUMAN — ' : ''}${f.job}  ${f.file}\n      ${f.open.join('; ')}`,
      )
    }
    console.log('\nNothing was un-approved. Work these in the review desk.')
  }

  if (failed.length) {
    console.log('\nFailed ids (left untouched):')
    for (const f of failed) console.log(`  ${f.id}  ${f.file}  ${f.error}`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
