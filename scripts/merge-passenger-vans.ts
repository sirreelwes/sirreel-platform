/**
 * Merge the passenger vans back into ONE class (Wes 2026-09-11: "let's
 * have all pass vans together") — the reverse of the 2026-09-09 split
 * (scripts/split-passenger-van.ts, journal split-passenger-van-*.json).
 *
 * The 15-passenger row is KEPT and becomes "Passenger Van": it carries
 * the Planyo resource (117158), forty booking rows and every alias, so
 * folding the two-unit 12-passenger row into it moves the least. The
 * 12-passenger row is retired the way the original single row was —
 * inactive, off every picker, FK intact for history.
 *
 *   assets        Pass 1, Pass 2            → merged category
 *   holds         every 12-passenger item   → merged category; where the
 *                 same booking already has a 15-passenger item (the three
 *                 MIXED holds the split divided) the two rows are folded
 *                 back into one: quantity added, assignments re-pointed,
 *                 the 12 row deleted — a booking with two items on one
 *                 class mis-sizes holdOnQuoteSend and double-lists on the
 *                 board
 *   order lines   inventoryItemId / assetCategoryId → merged row; line
 *                 DESCRIPTIONS are left alone (sent quotes stay as sent)
 *   public tiles  the /vehicles "12-Passenger Van" tile keeps its page but
 *                 points its availability at the merged class
 *   aliases       direct rows here AND prisma/seeds/2026-05-08-catalog-
 *                 aliases.ts (the seed is the owner; run it after)
 *
 * Journals every id it touches, before-values included, so it can be
 * walked back by captured id. Dry run by default; --write to apply.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/merge-passenger-vans.ts [--write]
 */
import { writeFileSync, mkdirSync } from 'fs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const WRITE = process.argv.includes('--write')

const KEEP_CODE = 'CAT_PASSENGER_VAN_15'
const FOLD_CODE = 'CAT_PASSENGER_VAN_12'
const MERGED_NAME = 'Passenger Van'
const MERGED_SLUG = 'passenger-van'
const RETIRED_NAME = '12-Passenger Van (retired — merged back into Passenger Van)'
const RETIRED_SLUG = '12-passenger-van-retired'

async function main() {
  const keep = await prisma.inventoryItem.findUnique({ where: { code: KEEP_CODE }, select: { id: true, code: true, description: true, slug: true, qtyOwned: true, legacyAssetCategoryId: true } })
  const fold = await prisma.inventoryItem.findUnique({ where: { code: FOLD_CODE }, select: { id: true, code: true, description: true, slug: true, qtyOwned: true, legacyAssetCategoryId: true, isActive: true, reservableOnGantt: true, publicVisible: true } })
  if (!keep?.legacyAssetCategoryId || !fold?.legacyAssetCategoryId) throw new Error('both passenger rows with categories are required')
  const KC = keep.legacyAssetCategoryId, FC = fold.legacyAssetCategoryId
  const keepCat = await prisma.assetCategory.findUnique({ where: { id: KC }, select: { id: true, name: true, slug: true, aliases: true } })
  const foldCat = await prisma.assetCategory.findUnique({ where: { id: FC }, select: { id: true, name: true, slug: true, aliases: true } })
  if (!keepCat || !foldCat) throw new Error('categories missing')
  for (const s of [MERGED_SLUG, RETIRED_SLUG]) {
    if (await prisma.inventoryItem.findFirst({ where: { slug: s, id: { notIn: [keep.id, fold.id] } } })) throw new Error(`inventory slug ${s} taken`)
    if (await prisma.assetCategory.findFirst({ where: { slug: s, id: { notIn: [KC, FC] } } })) throw new Error(`category slug ${s} taken`)
  }

  const assets = await prisma.asset.findMany({ where: { categoryId: FC }, select: { id: true, unitName: true } })
  const items = await prisma.bookingItem.findMany({
    where: { categoryId: FC },
    select: {
      id: true, bookingId: true, quantity: true, status: true, holdRank: true, notes: true, catalogItemId: true, dailyRate: true, lineTotal: true,
      rankLockedAt: true, rankLockedById: true, rankLockedReason: true,
      assignments: { select: { id: true, status: true, asset: { select: { unitName: true } } } },
      stageAreas: { select: { id: true } },
      booking: { select: { bookingNumber: true, jobName: true, items: { where: { categoryId: KC }, select: { id: true, quantity: true, status: true, holdRank: true, notes: true } } } },
    },
  })
  const lines = await prisma.orderLineItem.findMany({ where: { OR: [{ inventoryItemId: fold.id }, { assetCategoryId: FC }] }, select: { id: true, description: true, inventoryItemId: true, assetCategoryId: true, order: { select: { orderNumber: true } } } })
  const tiles = await prisma.vehicleCategory.findMany({ where: { assetCategoryId: FC }, select: { id: true, name: true, slug: true } })

  const journal: Record<string, unknown> = {
    ranAt: new Date().toISOString(), write: WRITE,
    keep: { item: keep, category: keepCat }, fold: { item: fold, category: foldCat },
    assets, items: items.map((i) => ({ ...i, booking: { bookingNumber: i.booking.bookingNumber, jobName: i.booking.jobName, sibling15: i.booking.items } })), lines, tiles,
    merged: [] as unknown[], moved: [] as unknown[],
  }
  console.log(`keep ${keep.code} (${keep.description}) cat ${KC.slice(0, 8)} qty ${keep.qtyOwned} | fold ${fold.code} cat ${FC.slice(0, 8)} qty ${fold.qtyOwned}`)
  console.log(`assets to move: ${assets.map((a) => a.unitName).join(', ')}`)
  console.log(`holds on the 12 row: ${items.length} (${items.filter((i) => i.booking.items.length > 0).length} with a 15 sibling to fold into)`)
  console.log(`order lines to re-point: ${lines.length} · public tiles: ${tiles.length}`)
  if (!WRITE) { console.log('\ndry run — pass --write'); return }

  await prisma.$transaction(async (tx) => {
    for (const a of assets) await tx.asset.update({ where: { id: a.id }, data: { categoryId: KC } })

    for (const it of items) {
      const sib = it.booking.items[0]
      if (sib) {
        // Fold into the 15 sibling: quantity adds, every assignment (any
        // status — history rides along) re-points, the 12 row goes.
        const moved = await tx.bookingAssignment.updateMany({ where: { bookingItemId: it.id }, data: { bookingItemId: sib.id } })
        if (it.stageAreas.length) await tx.bookingItemStageArea.updateMany({ where: { bookingItemId: it.id }, data: { bookingItemId: sib.id } })
        const liveStatus = it.status === 'UNFULFILLED' && sib.status === 'UNFULFILLED' ? 'UNFULFILLED' : sib.status === 'UNFULFILLED' ? it.status : sib.status
        const notes = [sib.notes, it.notes].filter(Boolean).join('\n') || undefined
        await tx.bookingItem.update({
          where: { id: sib.id },
          data: {
            quantity: it.status === 'UNFULFILLED' ? undefined : { increment: it.quantity },
            status: liveStatus,
            ...(notes ? { notes: { set: notes } } : {}),
          },
        })
        await tx.bookingItem.delete({ where: { id: it.id } })
        ;(journal.merged as unknown[]).push({ deleted12: it.id, into15: sib.id, quantityAdded: it.status === 'UNFULFILLED' ? 0 : it.quantity, assignmentsMoved: moved.count, siblingBefore: sib })
      } else {
        await tx.bookingItem.update({ where: { id: it.id }, data: { categoryId: KC, ...(it.catalogItemId === fold.id ? { catalogItemId: keep.id } : {}) } })
        ;(journal.moved as unknown[]).push({ item: it.id, from: FC, to: KC })
      }
    }

    for (const l of lines) {
      await tx.orderLineItem.update({
        where: { id: l.id },
        data: {
          ...(l.inventoryItemId === fold.id ? { inventoryItemId: keep.id } : {}),
          ...(l.assetCategoryId === FC ? { assetCategoryId: KC } : {}),
        },
      })
    }
    for (const t of tiles) await tx.vehicleCategory.update({ where: { id: t.id }, data: { assetCategoryId: KC } })

    // Names, slugs, counts, aliases. Aliases are the seed's to own — this
    // just keeps the DB coherent until the seed is re-run.
    const mergedAliases = Array.from(new Set([...(keepCat.aliases ?? []), ...(foldCat.aliases ?? [])]))
    await tx.assetCategory.update({ where: { id: KC }, data: { name: MERGED_NAME, slug: MERGED_SLUG, aliases: mergedAliases } })
    await tx.inventoryItem.update({ where: { id: keep.id }, data: { description: MERGED_NAME, slug: MERGED_SLUG, qtyOwned: keep.qtyOwned + fold.qtyOwned } })
    await tx.assetCategory.update({ where: { id: FC }, data: { name: RETIRED_NAME, slug: RETIRED_SLUG, aliases: [] } })
    await tx.inventoryItem.update({ where: { id: fold.id }, data: { description: RETIRED_NAME, slug: RETIRED_SLUG, qtyOwned: 0, isActive: false, reservableOnGantt: false, publicVisible: false } })
  }, { timeout: 60_000 })

  const after = await prisma.assetCategory.findMany({ where: { id: { in: [KC, FC] } }, select: { id: true, name: true, _count: { select: { assets: true, bookingItems: true } } } })
  journal.after = after
  console.log('after:', JSON.stringify(after))
  mkdirSync('journals', { recursive: true })
  const f = `journals/merge-passenger-vans-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(f, JSON.stringify(journal, null, 2))
  console.log('journal →', f)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
