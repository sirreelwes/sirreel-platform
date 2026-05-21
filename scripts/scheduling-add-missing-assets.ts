#!/usr/bin/env tsx
/**
 * Companion to scheduling-planyo-migration.ts (Chunk 7/7.5).
 *
 * After running the Planyo migration dry-run with the normalizer
 * applied, this script materializes the *genuinely missing* Asset
 * rows so a subsequent migration --write can complete with zero
 * unmatched units.
 *
 * The list below is a DRAFT — review with Julian before --write.
 * Three items are flagged with explicit open questions; resolve
 * them before persisting.
 *
 * Usage:
 *   npx tsx scripts/scheduling-add-missing-assets.ts            # dry-run, lists
 *                                                                 #  proposed creates
 *                                                                 #  and existing
 *                                                                 #  matches
 *   npx tsx scripts/scheduling-add-missing-assets.ts --write     # persist
 */

import { readFileSync } from 'fs'
import path from 'path'
import { PrismaClient, type AssetTier, type AssetStatus, type Location } from '@prisma/client'

const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const prisma = new PrismaClient()
const dryRun = !process.argv.includes('--write')

// ────────────────────────────────────────────────────────────────
// PROPOSED ADDS — review with Julian before running --write.
//
// Each row says: in which AssetCategory (by name) to add an Asset
// with the given unitName. Defaults: STANDARD tier, AVAILABLE
// status, LANKERSHIM location. Annotate `notes` with provenance
// so anyone re-reading the row later knows where it came from.
// ────────────────────────────────────────────────────────────────

interface ProposedAsset {
  categoryName: string
  unitName: string
  tier?: AssetTier
  status?: AssetStatus
  location?: Location
  notes?: string
  /** Why this is here, and any open question Julian should answer
   *  before --write. */
  reviewNote: string
}

const PROPOSED: ProposedAsset[] = [
  {
    categoryName: 'Cargo Van w/ Liftgate',
    unitName: 'Sprinter 1',
    reviewNote:
      'OPEN Q: Planyo has "Sprinter #1 (A)" in Cargo Van w/ Liftgate. Is this a distinct vehicle from existing Cargo N units, or just the brand-name surfaced in Planyo for one of them? If it IS the same vehicle as e.g. Cargo 1, rename that Asset to "Sprinter 1" instead of adding a new row.',
  },
  {
    categoryName: 'Cargo Van w/ Liftgate',
    unitName: 'Sprinter 2',
    reviewNote: 'Same OPEN Q as Sprinter 1.',
  },
  {
    categoryName: 'ProScout / VTR',
    unitName: 'Video Van',
    notes: 'Planyo annotation: "(w/ MiFi)" — kept as Planyo metadata, not in unitName.',
    reviewNote:
      'Planyo carries "Video Van (w/ MiFi)" in ProScout / VTR. Confirm this is a real distinct unit vs an existing ProScout asset under a different name.',
  },
  {
    categoryName: 'ProScout / VTR',
    unitName: 'Scout Van',
    notes: 'Planyo annotation: "(No MiFi)" — distinguishes it from Video Van (w/ MiFi).',
    reviewNote:
      'Planyo: "Scout Van (No MiFi)". Likely a real distinct unit from Video Van (the MiFi/No-MiFi pair). Confirm.',
  },
  {
    categoryName: 'Studios',
    unitName: 'Lankershim Studio',
    location: 'LANKERSHIM',
    reviewNote:
      'OPEN Q: Does "Lankershim Studio" in Planyo refer to a separate bookable space, or is it an alias for an existing Studios Asset (Standing Sets / LED Volume Stage)?  Julian: please confirm before --write.',
  },
]

// ────────────────────────────────────────────────────────────────
// NOT ADDED — items deliberately left for operator decision.
// ────────────────────────────────────────────────────────────────

const HOLD_FOR_DECISION = [
  {
    planyoName: '30 (A) Wardrobe',
    category: 'Cube Truck',
    note:
      'Is this Cube 30 with a "Wardrobe" annotation (same vehicle, descriptive suffix), or a separate "Cube 30 Wardrobe" unit? If the former, no add needed — the migration leaves the BookingItem REQUESTED and Julian assigns Cube 30 manually. If the latter, add an Asset named "Cube 30 Wardrobe".',
  },
  {
    planyoName: 'X - 2ND HOLD',
    category: 'ProScout / VTR',
    note:
      'Backup-hold placeholder. The normalizer correctly flags `isBackupHold=true`. Migration creates the BookingItem but no BookingAssignment. Confirm we want backup-holds to remain in the schedule as held capacity without a specific unit (vs. skip the BookingItem entirely).',
  },
]

async function main() {
  console.log(`Scheduling — proposed missing-Asset additions — ${dryRun ? 'DRY RUN' : 'LIVE WRITE'}`)
  console.log('')

  const categories = await prisma.assetCategory.findMany({
    select: { id: true, name: true, slug: true, totalUnits: true },
  })
  const catByName = new Map(categories.map((c) => [c.name, c]))

  // Validate every proposed category exists.
  const missingCats: string[] = []
  for (const p of PROPOSED) {
    if (!catByName.has(p.categoryName)) missingCats.push(p.categoryName)
  }
  if (missingCats.length > 0) {
    console.error(`Proposed assets reference unknown categories: ${missingCats.join(', ')}`)
    console.error('Fix the PROPOSED list above, then re-run.')
    process.exit(1)
  }

  // Look up existing Assets by (categoryId, unitName) so we don't
  // double-create on a re-run.
  const allAssets = await prisma.asset.findMany({ select: { id: true, categoryId: true, unitName: true } })
  const existing = new Set(allAssets.map((a) => `${a.categoryId}|${a.unitName}`))

  let willCreate = 0
  let willSkip = 0
  console.log('PROPOSED CREATES:')
  console.log('─'.repeat(80))
  for (const p of PROPOSED) {
    const cat = catByName.get(p.categoryName)!
    const key = `${cat.id}|${p.unitName}`
    const alreadyExists = existing.has(key)
    console.log(`  [${alreadyExists ? 'EXISTS' : 'NEW   '}] ${p.categoryName} / "${p.unitName}"`)
    console.log(`           ${p.reviewNote}`)
    if (alreadyExists) { willSkip++; continue }
    willCreate++
    if (!dryRun) {
      await prisma.asset.create({
        data: {
          categoryId: cat.id,
          unitName: p.unitName,
          tier: p.tier ?? 'STANDARD',
          status: p.status ?? 'AVAILABLE',
          location: p.location ?? 'LANKERSHIM',
          notes: [p.notes, `Auto-created by scheduling-add-missing-assets on ${new Date().toISOString().slice(0, 10)}`]
            .filter(Boolean).join('\n'),
        },
      })
      console.log(`           → created`)
    }
  }

  console.log('')
  console.log('HELD FOR JULIAN/WES DECISION — not added by this script:')
  console.log('─'.repeat(80))
  for (const h of HOLD_FOR_DECISION) {
    console.log(`  ${h.category} / "${h.planyoName}"`)
    console.log(`    ${h.note}`)
  }
  console.log('')
  console.log(`Summary: ${willCreate} would-create, ${willSkip} already-exist, ${HOLD_FOR_DECISION.length} held-for-decision`)
  if (dryRun) console.log('(dry run — pass --write to persist the would-create rows)')
}

main()
  .catch((e) => { console.error('[add-missing-assets] fatal:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
