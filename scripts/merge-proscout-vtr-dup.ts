#!/usr/bin/env tsx
/**
 * Merge the ProScout / VTR duplicate Asset rows.
 *
 * Background:
 *   Two Asset rows exist in the "ProScout / VTR" category for the same
 *   physical truck:
 *     - Phantom: `seed-proscout-1` ("ProScout 1") — original 2026-03-28
 *       seed entry. Zero attachments across all 8 Asset FKs (no bookings,
 *       no inspections, no maintenance, no checkouts, no claims, no
 *       lot-checks, no dispatch tasks, no incidents).
 *     - Keeper:  `92948011-19c3-4ad7-b041-f9b001150f5f` ("Video Van") —
 *       auto-created 2026-05-23 by scripts/scheduling-add-missing-assets.ts
 *       per fleet's clarification that "Video Van (w/ MiFi)" and
 *       "Scout Van (No MiFi)" are Planyo aliases for the same unit.
 *       Carries 6 BookingAssignment rows (3 future-dated, live).
 *
 *   The gantt assign-modal lists both as candidates because each is a
 *   distinct active Asset row in the same category. The fix: backfill
 *   the phantom's vehicle metadata onto the keeper (which is null on
 *   year/make/model) and soft-retire the phantom with isActive=false.
 *
 *   `src/lib/scheduling/availability.ts:159` filters `isActive: true`
 *   so soft-retiring is sufficient to hide the phantom from the picker
 *   without orphaning anything. No bookings move.
 *
 * Usage:
 *   npx tsx scripts/merge-proscout-vtr-dup.ts             # dry run
 *   npx tsx scripts/merge-proscout-vtr-dup.ts --apply     # commit
 *
 * Reverse:
 *   UPDATE assets SET is_active = true, notes = '<original>'
 *   WHERE id = 'seed-proscout-1';
 *   UPDATE assets SET year = NULL, make = NULL, model = NULL, notes = '<original>'
 *   WHERE id = '92948011-19c3-4ad7-b041-f9b001150f5f';
 *   -- Original notes captured in the apply-run output.
 */

import { readFileSync } from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

// env bootstrap
const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const prisma = new PrismaClient()

const PHANTOM_ID = 'seed-proscout-1'
const KEEPER_ID = '92948011-19c3-4ad7-b041-f9b001150f5f'
const CATEGORY_NAME = 'ProScout / VTR'
const TODAY = new Date().toISOString().slice(0, 10)

const APPLY = process.argv.includes('--apply')

async function main() {
  console.log(`ProScout / VTR duplicate merge — ${APPLY ? 'LIVE WRITE' : 'DRY RUN'}`)
  console.log(`Phantom: ${PHANTOM_ID}`)
  console.log(`Keeper:  ${KEEPER_ID}`)
  console.log('')

  // ── Load both rows (will throw if either is missing) ─────────────
  const [phantom, keeper, category] = await Promise.all([
    prisma.asset.findUnique({
      where: { id: PHANTOM_ID },
      select: { id: true, unitName: true, year: true, make: true, model: true, mileage: true, notes: true, isActive: true, categoryId: true },
    }),
    prisma.asset.findUnique({
      where: { id: KEEPER_ID },
      select: { id: true, unitName: true, year: true, make: true, model: true, mileage: true, notes: true, isActive: true, categoryId: true },
    }),
    prisma.assetCategory.findFirst({
      where: { name: CATEGORY_NAME },
      select: { id: true, name: true, totalUnits: true },
    }),
  ])

  if (!phantom) throw new Error(`Phantom asset ${PHANTOM_ID} not found`)
  if (!keeper) throw new Error(`Keeper asset ${KEEPER_ID} not found`)
  if (!category) throw new Error(`Category "${CATEGORY_NAME}" not found`)
  if (phantom.categoryId !== category.id || keeper.categoryId !== category.id) {
    throw new Error(`Both assets must live in "${CATEGORY_NAME}"`)
  }

  // ── Defensive: re-verify phantom has zero attachments before retiring ──
  // The earlier discovery printed zeros; this is the same check inline
  // so a re-run after some operator has manually re-pointed bookings
  // doesn't blindly soft-retire a row that's no longer empty.
  const [
    bookingAssignments, checkoutRecords, maintenanceRecords, dispatchTasks,
    inspections, insuranceClaims, lotChecks, incidents,
  ] = await Promise.all([
    prisma.bookingAssignment.count({ where: { assetId: PHANTOM_ID } }),
    prisma.checkoutRecord.count({ where: { assetId: PHANTOM_ID } }),
    prisma.maintenanceRecord.count({ where: { assetId: PHANTOM_ID } }),
    prisma.dispatchTask.count({ where: { assetId: PHANTOM_ID } }),
    prisma.inspection.count({ where: { assetId: PHANTOM_ID } }),
    prisma.insuranceClaim.count({ where: { assetId: PHANTOM_ID } }),
    prisma.lotCheck.count({ where: { assetId: PHANTOM_ID } }),
    prisma.incident.count({ where: { assetId: PHANTOM_ID } }),
  ])
  const totalAttach = bookingAssignments + checkoutRecords + maintenanceRecords
    + dispatchTasks + inspections + insuranceClaims + lotChecks + incidents
  console.log(`Phantom attachment check (must be 0 to proceed):`)
  console.log(`  bookingAssignments=${bookingAssignments} checkouts=${checkoutRecords} maint=${maintenanceRecords} dispatch=${dispatchTasks} inspections=${inspections} claims=${insuranceClaims} lotChecks=${lotChecks} incidents=${incidents}`)
  if (totalAttach > 0) {
    throw new Error(
      `Phantom ${PHANTOM_ID} now has ${totalAttach} attached row(s). Re-run STEP 0 discovery and decide before merging.`,
    )
  }
  console.log(`  → 0 total. Safe to soft-retire.`)
  console.log('')

  // ── Plan the writes ─────────────────────────────────────────────
  // Backfill keeper metadata ONLY where the keeper's field is null.
  const keeperBackfill: { year?: number; make?: string; model?: string; mileage?: number } = {}
  if (keeper.year === null && phantom.year !== null) keeperBackfill.year = phantom.year
  if (keeper.make === null && phantom.make !== null) keeperBackfill.make = phantom.make
  if (keeper.model === null && phantom.model !== null) keeperBackfill.model = phantom.model
  if (keeper.mileage === null && phantom.mileage !== null) keeperBackfill.mileage = phantom.mileage

  const keeperAuditLine = `Merged ${PHANTOM_ID} (duplicate of same physical truck) on ${TODAY}; metadata backfilled: ${Object.keys(keeperBackfill).join(', ') || '(no-op — keeper already populated)'}.`
  const keeperNewNotes = keeper.notes
    ? `${keeper.notes}\n${keeperAuditLine}`
    : keeperAuditLine

  const phantomAuditLine = `Soft-retired ${TODAY}: duplicate of keeper ${KEEPER_ID} ("${keeper.unitName}"). Same physical truck per fleet; zero attachments on this row at retirement. See scripts/merge-proscout-vtr-dup.ts for context.`
  const phantomNewNotes = phantom.notes
    ? `${phantom.notes}\n${phantomAuditLine}`
    : phantomAuditLine

  // After phantom flips isActive=false, totalUnits should be the count
  // of active assets remaining in the category (expected: 1).
  const activeCountAfter = await prisma.asset.count({
    where: { categoryId: category.id, isActive: true, id: { not: PHANTOM_ID } },
  })

  // ── Print before/after for every field this would change ─────────
  console.log('Planned writes:')
  console.log(`\n  [Asset ${keeper.id}] keeper "${keeper.unitName}"`)
  for (const [k, v] of Object.entries(keeperBackfill)) {
    console.log(`    ${k}:  ${JSON.stringify(keeper[k as keyof typeof keeper])}  →  ${JSON.stringify(v)}`)
  }
  if (Object.keys(keeperBackfill).length === 0) {
    console.log(`    (no metadata backfill — keeper already has year/make/model/mileage)`)
  }
  console.log(`    notes:`)
  console.log(`      before: ${JSON.stringify(keeper.notes)}`)
  console.log(`      after:  ${JSON.stringify(keeperNewNotes)}`)

  console.log(`\n  [Asset ${phantom.id}] phantom "${phantom.unitName}"`)
  console.log(`    isActive:  ${phantom.isActive}  →  false`)
  console.log(`    notes:`)
  console.log(`      before: ${JSON.stringify(phantom.notes)}`)
  console.log(`      after:  ${JSON.stringify(phantomNewNotes)}`)

  console.log(`\n  [AssetCategory ${category.id}] "${category.name}"`)
  console.log(`    totalUnits:  ${category.totalUnits}  →  ${activeCountAfter}`)

  if (!APPLY) {
    console.log(`\nDRY RUN — pass --apply to commit.`)
    await prisma.$disconnect()
    return
  }

  // ── Single transaction ──────────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    if (Object.keys(keeperBackfill).length > 0 || keeperNewNotes !== keeper.notes) {
      await tx.asset.update({
        where: { id: KEEPER_ID },
        data: { ...keeperBackfill, notes: keeperNewNotes },
      })
    }
    await tx.asset.update({
      where: { id: PHANTOM_ID },
      data: { isActive: false, notes: phantomNewNotes },
    })
    await tx.assetCategory.update({
      where: { id: category.id },
      data: { totalUnits: activeCountAfter },
    })
  })

  console.log(`\nApplied. ${KEEPER_ID} updated, ${PHANTOM_ID} soft-retired, category totalUnits = ${activeCountAfter}.`)
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
