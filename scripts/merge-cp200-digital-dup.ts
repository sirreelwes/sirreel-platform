#!/usr/bin/env tsx
/**
 * Merge the two digital CP200 rows — same radio (Wes, 2026-08-17).
 *
 *   KEEP    d61119ab  "Motorola CP200  UHF Radio (Digital)"  91 units
 *           RW-backed (I-Code 104387, InventoryId A00022V4), structured
 *           code, replacementCost 490, and a name that matches the
 *           Analog twin's convention so the pair reads as one set.
 *
 *   ARCHIVE f7ef9d54  "Motorola CP200d  UHF Radio (Digital)"  21 units
 *           April seed row, code == description, no RW linkage. Carries
 *           the default-walkie aliases, which move to the keeper.
 *
 * Stock:
 *   The merged row keeps 91, not 112. Same call Wes made on the Rubber
 *   Mats pair: the RW-backed count supersedes the older seed count
 *   rather than adding to it. Under-counting is the safe direction —
 *   these get promised to crews off the pull sheet. Reversible below if
 *   a warehouse count says otherwise.
 *
 * Rates:
 *   Already identical ($10/day, $30/week) — nothing to reconcile.
 *
 * Aliases — the important half, and the reason this is not a DB-only fix:
 *   scripts/seed-catalog-aliases.ts is the source of truth for aliases
 *   (a direct DB write to them gets reverted on its next run — learned
 *   the hard way earlier today). Its "Walkies default to digital
 *   (Wes, 8/17)" entry pins the DIGITAL target by id, and that id is the
 *   row this script archives. So the seed entry must be repointed to the
 *   keeper in the same change, or the default walkie lands on a dead row.
 *
 *   This script still copies the aliases across so the keeper is never
 *   alias-less in between; the seed then normalises (it strips plurals
 *   on purpose — aliasHit() already allows a trailing s).
 *
 *   'cp200d' is added to the seed's digital entry separately: today the
 *   loser is reachable by that word via its own name token, and archiving
 *   it would otherwise make the model designation unsearchable.
 *
 * Usage:
 *   npx tsx scripts/merge-cp200-digital-dup.ts           # dry run
 *   npx tsx scripts/merge-cp200-digital-dup.ts --apply   # commit
 *
 * Reverse:
 *   UPDATE inventory_items SET is_active = true, archived_at = NULL,
 *          internal_flags = '{}'
 *    WHERE id = 'f7ef9d54-bfdc-4342-92f0-856ecaee0239';
 *   UPDATE inventory_items SET aliases = '{}'
 *    WHERE id = 'd61119ab-5af1-4de5-a601-28a22944a956';
 *   -- then revert the id/name in scripts/seed-catalog-aliases.ts.
 */

import { readFileSync } from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

const KEEPER_ID = 'd61119ab-5af1-4de5-a601-28a22944a956'
const LOSER_ID = 'f7ef9d54-bfdc-4342-92f0-856ecaee0239'
const REPOINT_SANITY_CAP = 20

const EXPECT_KEEPER = {
  description: 'Motorola CP200  UHF Radio (Digital)',
  qtyOwned: 91, dailyRate: '10', weeklyRate: '30', isActive: true, aliases: [] as string[],
}
const EXPECT_LOSER = {
  description: 'Motorola CP200d  UHF Radio (Digital)',
  qtyOwned: 21, dailyRate: '10', weeklyRate: '30', isActive: true,
  aliases: ['walkie', 'walkie talkie', 'handheld', 'two-way radio', 'two way radio', 'radio', 'cp200'],
}

const SELECT = {
  id: true, code: true, description: true, dailyRate: true, weeklyRate: true, qtyOwned: true,
  isActive: true, aliases: true, internalFlags: true, replacementCost: true, locationId: true,
  category: { select: { name: true } },
} as const

async function hardRefs(id: string) {
  const [lineItems, packageItems, subRentals, assets, bookingItems, vehicleCategories] = await Promise.all([
    prisma.orderLineItem.count({ where: { inventoryItemId: id } }),
    prisma.packageItem.count({ where: { inventoryItemId: id } }),
    prisma.subRental.count({ where: { inventoryItemId: id } }),
    prisma.asset.count({ where: { catalogItemId: id } }),
    prisma.bookingItem.count({ where: { catalogItemId: id } }),
    prisma.vehicleCategory.count({ where: { catalogItemId: id } }),
  ])
  return { lineItems, packageItems, subRentals, assets, bookingItems, vehicleCategories }
}

function checkDrift(row: any, id: string, want: any, role: string) {
  if (!row) throw new Error(`${role} ${id} not found.`)
  const got: Record<string, unknown> = {
    description: row.description, qtyOwned: row.qtyOwned,
    dailyRate: String(row.dailyRate), weeklyRate: String(row.weeklyRate),
    isActive: row.isActive, aliases: row.aliases,
  }
  const drift = Object.keys(want)
    .filter((k) => JSON.stringify(got[k]) !== JSON.stringify(want[k]))
    .map((k) => `${k}: expected ${JSON.stringify(want[k])}, found ${JSON.stringify(got[k])}`)
  if (drift.length) {
    throw new Error(
      `${role} ${id} has drifted since this merge was written:\n` +
        drift.map((d) => `    - ${d}`).join('\n') +
        `\n  These rows are hand-edited and seed-driven. Re-check before running.`,
    )
  }
}

async function main() {
  console.log(`CP200 digital duplicate merge — ${APPLY ? 'LIVE WRITE' : 'DRY RUN'}\n`)

  const [keeper, loser] = await Promise.all([
    prisma.inventoryItem.findUnique({ where: { id: KEEPER_ID }, select: SELECT }),
    prisma.inventoryItem.findUnique({ where: { id: LOSER_ID }, select: SELECT }),
  ])
  checkDrift(keeper, KEEPER_ID, EXPECT_KEEPER, 'keeper')
  checkDrift(loser, LOSER_ID, EXPECT_LOSER, 'loser')
  const K = keeper!, L = loser!

  const mergedAliases = [...new Set([...K.aliases, ...L.aliases])]
  const refs = await hardRefs(LOSER_ID)
  const refTotal = Object.values(refs).reduce((a, b) => a + b, 0)
  if (refTotal > REPOINT_SANITY_CAP)
    throw new Error(`loser has ${refTotal} referencing rows (cap ${REPOINT_SANITY_CAP}) — stop and look.`)
  const rateChanges = await prisma.rateChangeLog.count({ where: { inventoryItemId: LOSER_ID } })

  console.log(`  KEEP    ${K.id}`)
  console.log(`          "${K.description}"  code="${K.code}"  ${K.category?.name}`)
  console.log(`          qty=${K.qtyOwned} (unchanged — RW count supersedes the loser's ${L.qtyOwned}, not summed)`)
  console.log(`    aliases:  ${JSON.stringify(K.aliases)}  ->  ${JSON.stringify(mergedAliases)}`)
  console.log(`\n  ARCHIVE ${L.id}`)
  console.log(`          "${L.description}"  code="${L.code}"  ${L.category?.name}`)
  console.log(`    isActive:  true  ->  false`)
  console.log(`    archivedAt: null  ->  <now>`)
  console.log(`    internalFlags: ${JSON.stringify(L.internalFlags)}  ->  ${JSON.stringify([...L.internalFlags, `MERGED_INTO:${K.id}`])}`)
  console.log(`\n  references on loser: ${refTotal} ${JSON.stringify(refs)}`)
  if (refTotal > 0) console.log(`    -> will be re-pointed to ${K.id}`)
  console.log(`  rateChangeLog on loser: ${rateChanges} (left in place — audit history stays where it happened)`)
  console.log(`\n  REMINDER: scripts/seed-catalog-aliases.ts must point its digital entry at`)
  console.log(`  ${KEEPER_ID} ("${K.description}") or the default walkie lands on an archived row.`)

  if (!APPLY) {
    console.log('\nDRY RUN — pass --apply to commit.')
    await prisma.$disconnect()
    return
  }

  await prisma.$transaction(async (tx) => {
    if (refs.lineItems) await tx.orderLineItem.updateMany({ where: { inventoryItemId: L.id }, data: { inventoryItemId: K.id } })
    if (refs.packageItems) await tx.packageItem.updateMany({ where: { inventoryItemId: L.id }, data: { inventoryItemId: K.id } })
    if (refs.subRentals) await tx.subRental.updateMany({ where: { inventoryItemId: L.id }, data: { inventoryItemId: K.id } })
    if (refs.assets) await tx.asset.updateMany({ where: { catalogItemId: L.id }, data: { catalogItemId: K.id } })
    if (refs.bookingItems) await tx.bookingItem.updateMany({ where: { catalogItemId: L.id }, data: { catalogItemId: K.id } })
    if (refs.vehicleCategories) await tx.vehicleCategory.updateMany({ where: { catalogItemId: L.id }, data: { catalogItemId: K.id } })

    await tx.inventoryItem.update({ where: { id: K.id }, data: { aliases: mergedAliases } })
    await tx.inventoryItem.update({
      where: { id: L.id },
      data: { isActive: false, archivedAt: new Date(), internalFlags: [...L.internalFlags, `MERGED_INTO:${K.id}`] },
    })
  })

  console.log(`\nApplied. Kept ${K.id} (${K.qtyOwned} units), archived ${L.id}.`)
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
