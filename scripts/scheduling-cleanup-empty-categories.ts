/*
 * Scheduling category cleanup.
 *
 * Two passes, both no-op-friendly. Defaults to dry-run; pass --write
 * to persist.
 *
 *   PASS 1 — Empty categories.
 *     For each AssetCategory with zero serviceable assets, audit
 *     incoming FK references (BookingItem, OrderLineItem). When none
 *     point at it, unpublish (isPublished=false). Reversible; just
 *     hides it from operator pickers / availability endpoints.
 *     When FKs exist, the category is flagged but left alone — those
 *     references mean code/data needs to move first; never auto-prune.
 *
 *   PASS 2 — totalUnits resync.
 *     For every PUBLISHED category, recompute totalUnits from the
 *     actual serviceable Asset count and update where they disagree.
 *     The engine doesn't read totalUnits (it counts Asset rows
 *     directly), but the /scheduling hub + UI summaries do, so the
 *     stale denorms misrepresent capacity.
 *
 * No deletes here — even when an empty category has zero FKs, soft
 * unpublish is safer than DELETE. A follow-up purge can hard-delete
 * once operators confirm nothing surfaces them by slug.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const args = process.argv.slice(2)
const dryRun = !args.includes('--write')

const OUT_OF_SERVICE = ['MAINTENANCE', 'RETIRED', 'SOLD', 'STOLEN']

async function main() {
  console.log(`Scheduling category cleanup — ${dryRun ? 'DRY RUN' : 'LIVE WRITE'}\n`)

  const categories = await prisma.assetCategory.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      isPublished: true,
      totalUnits: true,
      planyoResourceId: true,
      rwId: true,
    },
  })

  // ── PASS 1: empty categories ──
  console.log('=== PASS 1: empty-category audit ===\n')
  let unpublishedCount = 0
  let blockedByFks = 0
  let alreadyUnpublished = 0

  for (const c of categories) {
    const serviceable = await prisma.asset.count({
      where: {
        categoryId: c.id,
        isActive: true,
        status: { notIn: OUT_OF_SERVICE as any },
      },
    })
    if (serviceable > 0) continue

    const allAssets = await prisma.asset.count({ where: { categoryId: c.id } })
    const bookingItems = await prisma.bookingItem.count({ where: { categoryId: c.id } })
    const orderLineItems = await prisma.orderLineItem.count({ where: { assetCategoryId: c.id } })

    const fkLabel = `BookingItem:${bookingItems} OrderLineItem:${orderLineItems} Asset:${allAssets}`
    const planyoLabel = c.planyoResourceId == null ? '' : ` planyoResourceId=${c.planyoResourceId}`
    const rwLabel = c.rwId == null ? '' : ` rwId=${c.rwId}`

    if (!c.isPublished) {
      console.log(`  [already-unpublished] ${c.name.padEnd(28)} ${fkLabel}${planyoLabel}${rwLabel}`)
      alreadyUnpublished++
      continue
    }

    if (bookingItems > 0 || orderLineItems > 0) {
      console.log(`  [BLOCKED — FKs exist] ${c.name.padEnd(28)} ${fkLabel}${planyoLabel}${rwLabel}`)
      console.log(`    → leaving published. Migrate/reassign these rows before unpublishing.`)
      blockedByFks++
      continue
    }

    console.log(`  [unpublish]           ${c.name.padEnd(28)} ${fkLabel}${planyoLabel}${rwLabel}`)
    if (!dryRun) {
      await prisma.assetCategory.update({
        where: { id: c.id },
        data: { isPublished: false },
      })
    }
    unpublishedCount++
  }
  console.log('')
  console.log(`  unpublished: ${unpublishedCount}`)
  console.log(`  blocked (FKs present): ${blockedByFks}`)
  console.log(`  already unpublished:   ${alreadyUnpublished}`)
  console.log('')

  // ── PASS 2: totalUnits resync ──
  console.log('=== PASS 2: totalUnits resync (all categories) ===\n')
  let resyncedCount = 0
  let alreadyCorrect = 0

  for (const c of categories) {
    const serviceable = await prisma.asset.count({
      where: {
        categoryId: c.id,
        isActive: true,
        status: { notIn: OUT_OF_SERVICE as any },
      },
    })
    if (c.totalUnits === serviceable) {
      alreadyCorrect++
      continue
    }
    const arrow = serviceable < c.totalUnits ? '↓' : '↑'
    console.log(`  [${arrow}] ${c.name.padEnd(28)} totalUnits ${c.totalUnits} → ${serviceable}`)
    if (!dryRun) {
      await prisma.assetCategory.update({
        where: { id: c.id },
        data: { totalUnits: serviceable },
      })
    }
    resyncedCount++
  }
  console.log('')
  console.log(`  resynced:        ${resyncedCount}`)
  console.log(`  already correct: ${alreadyCorrect}`)
  console.log('')

  if (dryRun) {
    console.log('DRY RUN. Re-run with --write to apply.')
  } else {
    console.log('Done.')
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
