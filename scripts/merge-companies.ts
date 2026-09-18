#!/usr/bin/env tsx
/**
 * Merge duplicate Company rows into one keeper — command line.
 *
 * The MERGE ITSELF lives in src/lib/companies/mergeCompanies.ts, shared
 * with the "Merge duplicate…" button on the CRM company page. This file
 * is the CLI around it: argument parsing, the dry-run print-out, and the
 * journal file (which only exists here — Vercel has no writable disk, so
 * the UI path carries its reversal payload in the AuditLog row instead).
 *
 * Read that module for the rules. In short: every Company foreign key is
 * derived from the Prisma DMMF at runtime, Affiliation collisions
 * collapse with the keeper's row winning, keeper fields are backfilled
 * only where null, the keeper's NAME is never changed, and the duplicate
 * rows are deleted last so a missed FK throws instead of stranding rows.
 *
 * Usage:
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/merge-companies.ts --keeper <id> --dup <id> [--dup <id> ...]
 *   ... add --write to commit (omit for a dry run)
 *
 * Reverse: journals/company-merge-<ts>.json holds every duplicate Company
 *   body, every moved row id per model, and every deleted Affiliation
 *   body — as does AuditLog action `company.merge`, one row per merged
 *   company. Recreate the Company rows with their original ids, then move
 *   the captured ids back. Reversal is BY CAPTURED ID only.
 *
 * Runs to date:
 *   2026-08-29  CMS Media Inc / Crazy Maple Studios / ReelShort (d271ef71)
 *               ← CMS Picture Inc. (2593fcbb), Crazy Maple Studios
 *                 (65f8e1ee), Crazy Maple Studio (cce4d6d5)
 *   2026-08-29  same keeper ← ReelShort (5f48e301)
 *   2026-09-05  same keeper ← CMS Productions (b7d1332c), Reel Short LLC
 *               (b8ad4100) — re-created after the first merge (Wes: "they
 *               are all one company")
 *   2026-09-18  High Horses (0a6f8e3a) ← High Horse (397aad60) — the COI
 *               review desk had moved the job, order, bookings and COI to
 *               a second row, stranding the card on file. Wes picked the
 *               keeper; the certificate still names "High Horse", so the
 *               job reads MISMATCH until someone settles the name.
 */

import { prisma } from '@/lib/prisma'
import {
  planCompanyMerge,
  applyCompanyMerge,
  affiliationScore,
} from '@/lib/companies/mergeCompanies'
import { writeFileSync, mkdirSync } from 'node:fs'

/** Read repeated `--flag value` pairs off argv. */
function argValues(flag: string): string[] {
  const out: string[] = []
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === flag) out.push(process.argv[i + 1])
  }
  return out
}

const KEEPER_ID = argValues('--keeper')[0]
const DUP_IDS = argValues('--dup')
if (!KEEPER_ID || DUP_IDS.length === 0) {
  console.error('usage: merge-companies.ts --keeper <id> --dup <id> [--dup <id> ...] [--write]')
  process.exit(1)
}

const WRITE = process.argv.includes('--write')

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  console.log(`Company merge — ${WRITE ? 'LIVE WRITE' : 'DRY RUN (pass --write to apply)'}\n`)

  const plan = await planCompanyMerge({ keeperId: KEEPER_ID, duplicateIds: DUP_IDS })

  const keeper = plan.keeper as { id: string; name: string; tier: string; rentalworksCustomerId: string | null }
  console.log(`KEEPER  ${keeper.id}  ${keeper.name}  (${keeper.tier}, rw=${keeper.rentalworksCustomerId ?? '—'})`)
  for (const d of plan.duplicates) console.log(`DUP     ${d.id}  ${d.name}`)
  console.log('')

  for (const a of plan.affiliationsDeleted) {
    console.log(`  affiliation collision: person ${a.personId.slice(0, 8)} ` +
      `production "${a.productionName ?? '—'}" — drop ${a.id.slice(0, 8)} ` +
      `(${a.companyId.slice(0, 8)}, score ${affiliationScore(a)})`)
  }
  console.log(`  → ${plan.affiliationsDeleted.length} affiliations dropped as duplicates\n`)

  console.log('ROWS TO REPOINT ONTO THE KEEPER')
  for (const c of plan.counts) console.log(`  ${c.model.padEnd(18)} ${c.rows}`)
  if (!plan.counts.length) console.log('  (none)')
  console.log('')

  console.log('KEEPER BACKFILL')
  for (const [k, v] of Object.entries(plan.backfill)) console.log(`  ${k} = ${String(v).slice(0, 90)}`)
  console.log('')

  mkdirSync('journals', { recursive: true })
  const journalPath = `journals/company-merge-${stamp}.json`
  writeFileSync(journalPath, JSON.stringify({
    ranAt: new Date().toISOString(),
    mode: WRITE ? 'write' : 'dry-run',
    keeperId: KEEPER_ID,
    keeperBefore: plan.keeper,
    duplicates: plan.duplicates,
    moves: plan.moves,
    movesByDuplicate: plan.movesByDuplicate,
    affiliationsDeleted: plan.affiliationsDeleted,
    backfill: plan.backfill,
  }, null, 2))
  console.log(`journal → ${journalPath}`)

  if (!WRITE) {
    console.log('\nDRY RUN — nothing written.')
    return
  }

  const result = await applyCompanyMerge({
    plan,
    mergedById: null,
    via: 'script',
    journalPath,
  })

  const after = await prisma.company.findMany({
    where: { id: { in: [KEEPER_ID, ...DUP_IDS] } },
    select: { id: true, name: true },
  })
  console.log(`\nDONE. ${result.movedRows} rows repointed. Company rows remaining for this client: ${after.length}`)
  for (const c of after) console.log(`  ${c.id}  ${c.name}`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
