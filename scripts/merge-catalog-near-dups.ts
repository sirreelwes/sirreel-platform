#!/usr/bin/env tsx
/**
 * Merge near-duplicate InventoryItem rows (Aug 2026 catalog cleanup).
 *
 * Background:
 *   The catalog accumulated three generations of rows that never got
 *   reconciled against each other:
 *     - 2026-04-12  original seed        — code == description, real
 *                                          qtyOwned, publicVisible=false
 *     - 2026-05-24  supply-catalog-seed  — structured codes
 *                                          (DOL-/BAS-/EFX-), rate from the
 *                                          Production Supplies PDF,
 *                                          publicVisible=true, qtyOwned
 *                                          NEVER written by the seed
 *     - 2026-06/07  RW import            — numeric or RW I-Code codes
 *
 *   Where the same physical item landed in two generations, the stock
 *   ended up on one row and the client-facing rate on the other. A quote
 *   line matching either one is wrong in a different way: a $0 rental, or
 *   a promise against zero inventory.
 *
 *   Found by a description sweep gated on matching measurements (so
 *   "Ladder, 7'" vs "Ladder - 4'" and "Bleached" vs "Unbleached Muslin"
 *   correctly stay distinct SKUs, being different items rather than
 *   different spellings).
 *
 * Survivor rule (Wes, 2026-08-17):
 *   The curated supply-catalog-seed row survives where one exists. It
 *   carries the structured code, the correct category, publicVisible,
 *   and the AI-matching aliases. This also makes the merge durable:
 *   supply-catalog-seed.ts upserts by `code` and would otherwise
 *   recreate the duplicate on its next run. None of the losers' codes
 *   appear in supply-catalog-seed.json, so no re-run resurrects them
 *   (asserted below).
 *
 * Rates:
 *   weekly = 3x daily is the house convention (1,181 of 1,497 rows that
 *   carry both). Where the twins each held one half of a rate card entry
 *   ($20/day vs $60/week) they are not in conflict and the merged row
 *   gets both columns.
 *
 * NOT in this run:
 *   - Motorola CP200 radios. Not a duplicate pair but a 7-row family
 *     (Analog 287u / Digital 91u / CP200d 21u / Sub 0u + 3 inactive)
 *     where analog-vs-digital is a real distinction, and two of those
 *     rows were being actively edited on 2026-08-17. Needs its own pass.
 *   - Roscoe / Rosco V-Hazer (Water Based). Genuine duplicate, but the
 *     twins disagree on price ($60/day vs $110/day) — a pricing call.
 *   - Tennis Ball(s), Cube Tap(s). Both twins at qtyOwned=0, rates
 *     disagree, Expendables. Low stakes, deferred.
 *
 * Safety:
 *   - Dry run by default; --apply to commit.
 *   - Every row is addressed by captured id. No deleteMany, no pattern
 *     match, nothing deleted at all — losers are soft-archived
 *     (isActive=false + archivedAt), which is already the universal
 *     exclude filter on catalog / search / matcher / picker.
 *   - Pre-state is asserted before any write. The catalog was being
 *     edited by hand the same day this was written, so a row that has
 *     drifted from what was surveyed aborts the run rather than
 *     clobbering someone's work.
 *   - RateChangeLog rows are deliberately NOT re-pointed. They are an
 *     audit trail of a rate change that happened on THAT row; moving
 *     them would rewrite history. The loser is archived, not deleted,
 *     so nothing is orphaned.
 *
 * Usage:
 *   npx tsx scripts/merge-catalog-near-dups.ts            # dry run
 *   npx tsx scripts/merge-catalog-near-dups.ts --apply    # commit
 *
 * Reverse (per pair — captured ids, values from the apply-run output):
 *   UPDATE inventory_items SET is_active = true, archived_at = NULL,
 *          internal_flags = '{}' WHERE id = '<loserId>';
 *   UPDATE inventory_items SET qty_owned = <before>, daily_rate = <before>,
 *          weekly_rate = <before>, location_id = <before>,
 *          replacement_cost = <before>, category_id = '<before>'
 *   WHERE id = '<keeperId>';
 */

import { readFileSync } from 'fs'
import path from 'path'
import { PrismaClient, Prisma } from '@prisma/client'

// env bootstrap — matches scripts/merge-proscout-vtr-dup.ts
const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const TODAY = new Date().toISOString().slice(0, 10)

/** Re-pointing more than this many rows means the world changed. Abort. */
const REPOINT_SANITY_CAP = 20

type Expect = {
  description: string
  qtyOwned: number
  dailyRate: string
  weeklyRate: string
  isActive: boolean
}

type Pair = {
  label: string
  keeperId: string
  loserId: string
  expectKeeper: Expect
  expectLoser: Expect
  /** Explicit, Wes-approved field values for the merged row. */
  merge: {
    qtyOwned: number
    dailyRate: string
    weeklyRate: string
    /** 'fromLoser' copies the loser's value when the keeper's is null. */
    takeLocationId?: boolean
    takeReplacementCost?: boolean
    takeCategoryFromLoser?: boolean
  }
  why: string
}

const PAIRS: Pair[] = [
  {
    label: "Rubbermaid Cart",
    keeperId: '36f41fda-884e-4850-b29b-685cb11c329b',
    loserId: 'f012e748-1ff1-431e-9833-7b60ed4eccaf',
    expectKeeper: { description: 'Rubbermaid Cart', qtyOwned: 0, dailyRate: '20', weeklyRate: '0', isActive: true },
    expectLoser: { description: 'Rubber Maid Cart', qtyOwned: 8, dailyRate: '0', weeklyRate: '60', isActive: true },
    // $20/day and $60/week are the same rate under the 3x convention —
    // the twins were never in conflict, each just held one column.
    merge: { qtyOwned: 8, dailyRate: '20', weeklyRate: '60', takeLocationId: true },
    why: 'Keeper is the curated seed row (DOL-RUBBERMAID-CART, Dollies & Carts, publicVisible, holds the "production cart"/"utility cart" aliases). Takes the loser\'s 8 units and its $60 weekly.',
  },
  {
    label: "Rubber Mats, 3'x5'",
    keeperId: '6354caa1-a6ba-441d-8ffe-e05e815c06d4',
    loserId: '6d76cc1b-ef11-4176-8c19-782fc5e68ce3',
    expectKeeper: { description: "Rubber Mats, 3'x5'", qtyOwned: 82, dailyRate: '5', weeklyRate: '15', isActive: true },
    expectLoser: { description: "Rubber Mat 3' x 5'", qtyOwned: 9, dailyRate: '5', weeklyRate: '15', isActive: true },
    // Wes: the legacy 9 is a stale pre-seed count the 82 supersedes.
    // NOT summed. Rates already agree, so only locationId moves.
    merge: { qtyOwned: 82, dailyRate: '5', weeklyRate: '15', takeLocationId: true },
    why: "Keeper is the curated seed row (BAS-RUBBER-MATS-3X5, Basecamp Basics, replacementCost + image). Wes: keep 82, the legacy 9 is a stale duplicate count, not 9 more mats.",
  },
  {
    label: "Loco Mat - 3'x5'",
    keeperId: '130de7b4-1686-43c7-acd1-ce2b4d34e153',
    loserId: '6a1eaaa6-d011-4811-a46f-d1daed4d6ff5',
    expectKeeper: { description: "Loco Mat - 3' x 5'", qtyOwned: 90, dailyRate: '0', weeklyRate: '15', isActive: true },
    expectLoser: { description: "Loco Mat - 3'x5'", qtyOwned: 1, dailyRate: '6', weeklyRate: '15', isActive: true },
    // Neither row came from the curated seed, so the survivor rule above
    // doesn't apply. Wes picked the 90-unit row: the twin's qtyOwned=1
    // alongside a replacementCost reads as an RW-import stub, not stock.
    // $5/day (not the twin's $6) keeps it consistent with the existing
    // $15/week under the 3x convention.
    merge: {
      qtyOwned: 90, dailyRate: '5', weeklyRate: '15',
      takeReplacementCost: true, takeCategoryFromLoser: true,
    },
    why: "Wes: keep the 90-unit row, price at $5/day so it squares with its own $15/week. Takes replacementCost=75 and the Safety & Traffic category off the RW stub.",
  },
  {
    label: 'Roscoe Fogger 1900',
    keeperId: '8f73402c-7a0f-407b-b55d-dbe5c25a0d7c',
    loserId: '2391dbc9-7cb1-496b-bbca-ad2ddf6d9d50',
    expectKeeper: { description: 'Roscoe Fogger 1900', qtyOwned: 0, dailyRate: '50', weeklyRate: '0', isActive: true },
    expectLoser: { description: 'Rosco 1900 Fogger', qtyOwned: 1, dailyRate: '50', weeklyRate: '150', isActive: true },
    // Daily rates already agree at $50; only the weekly column and the
    // single unit move across.
    merge: { qtyOwned: 1, dailyRate: '50', weeklyRate: '150', takeLocationId: true },
    why: 'Keeper is the curated seed row (EFX-ROSCOE-FOGGER-1900, Effects, publicVisible). Rates already agree at $50/day; takes the loser\'s 1 unit and its $150 weekly.',
  },
]

const SELECT = {
  id: true, code: true, description: true, dailyRate: true, weeklyRate: true,
  qtyOwned: true, isActive: true, archivedAt: true, publicVisible: true,
  locationId: true, replacementCost: true, categoryId: true, aliases: true,
  internalFlags: true, category: { select: { name: true } },
} as const

type Row = Prisma.InventoryItemGetPayload<{ select: typeof SELECT }>

/** Hard FKs — rows that would be orphaned on an archived catalog row. */
async function hardRefs(id: string) {
  const [lineItems, packageItems, subRentals, assets, bookingItems, vehicleCategories] =
    await Promise.all([
      prisma.orderLineItem.count({ where: { inventoryItemId: id } }),
      prisma.packageItem.count({ where: { inventoryItemId: id } }),
      prisma.subRental.count({ where: { inventoryItemId: id } }),
      prisma.asset.count({ where: { catalogItemId: id } }),
      prisma.bookingItem.count({ where: { catalogItemId: id } }),
      prisma.vehicleCategory.count({ where: { catalogItemId: id } }),
    ])
  return { lineItems, packageItems, subRentals, assets, bookingItems, vehicleCategories }
}

function assertState(row: Row | null, id: string, want: Expect, role: string, label: string) {
  if (!row) throw new Error(`[${label}] ${role} ${id} not found.`)
  const got: Expect = {
    description: row.description ?? '',
    qtyOwned: row.qtyOwned,
    dailyRate: String(row.dailyRate),
    weeklyRate: String(row.weeklyRate),
    isActive: row.isActive,
  }
  const drift = (Object.keys(want) as (keyof Expect)[])
    .filter((k) => got[k] !== want[k])
    .map((k) => `${k}: expected ${JSON.stringify(want[k])}, found ${JSON.stringify(got[k])}`)
  if (drift.length) {
    throw new Error(
      `[${label}] ${role} ${id} has drifted since this merge was surveyed:\n` +
        drift.map((d) => `    - ${d}`).join('\n') +
        `\n  The catalog is being edited by hand. Re-survey and update PAIRS before running.`,
    )
  }
}

async function main() {
  console.log(`Catalog near-duplicate merge — ${APPLY ? 'LIVE WRITE' : 'DRY RUN'}`)
  console.log(`${PAIRS.length} pairs\n`)

  // Guard: a loser whose code is in the curated seed would be resurrected
  // (isActive=true) by the next supply-catalog-seed run.
  const seedCodes = new Set<string>(
    (JSON.parse(readFileSync(path.join(process.cwd(), 'scripts/supply-catalog-seed.json'), 'utf8'))
      .items as { code: string }[]).map((i) => i.code),
  )

  const plans: {
    pair: Pair; keeper: Row; loser: Row
    keeperData: Prisma.InventoryItemUpdateInput
    changes: string[]
    refs: Awaited<ReturnType<typeof hardRefs>>
    rateChangeCount: number
  }[] = []

  for (const pair of PAIRS) {
    const [keeper, loser] = await Promise.all([
      prisma.inventoryItem.findUnique({ where: { id: pair.keeperId }, select: SELECT }),
      prisma.inventoryItem.findUnique({ where: { id: pair.loserId }, select: SELECT }),
    ])
    assertState(keeper, pair.keeperId, pair.expectKeeper, 'keeper', pair.label)
    assertState(loser, pair.loserId, pair.expectLoser, 'loser', pair.label)
    const K = keeper as Row, L = loser as Row

    if (seedCodes.has(L.code)) {
      throw new Error(
        `[${pair.label}] loser code "${L.code}" is in supply-catalog-seed.json — ` +
          `archiving it would be undone by the next seed run. Remove it from the seed first.`,
      )
    }

    const data: Prisma.InventoryItemUpdateInput = {}
    const changes: string[] = []
    const note = (field: string, before: unknown, after: unknown) =>
      changes.push(`    ${field}:  ${JSON.stringify(before)}  ->  ${JSON.stringify(after)}`)

    if (K.qtyOwned !== pair.merge.qtyOwned) {
      data.qtyOwned = pair.merge.qtyOwned
      note('qtyOwned', K.qtyOwned, pair.merge.qtyOwned)
    }
    if (String(K.dailyRate) !== pair.merge.dailyRate) {
      data.dailyRate = new Prisma.Decimal(pair.merge.dailyRate)
      note('dailyRate', String(K.dailyRate), pair.merge.dailyRate)
    }
    if (String(K.weeklyRate) !== pair.merge.weeklyRate) {
      data.weeklyRate = new Prisma.Decimal(pair.merge.weeklyRate)
      note('weeklyRate', String(K.weeklyRate), pair.merge.weeklyRate)
    }
    // Fill-if-empty only — never overwrite a value the keeper already has.
    if (pair.merge.takeLocationId && K.locationId === null && L.locationId !== null) {
      data.locationRef = { connect: { id: L.locationId } }
      note('locationId', K.locationId, L.locationId)
    }
    if (pair.merge.takeReplacementCost && K.replacementCost === null && L.replacementCost !== null) {
      data.replacementCost = L.replacementCost
      note('replacementCost', K.replacementCost, String(L.replacementCost))
    }
    if (pair.merge.takeCategoryFromLoser && L.categoryId && K.categoryId !== L.categoryId) {
      data.category = { connect: { id: L.categoryId } }
      note('categoryId', `${K.categoryId} (${K.category?.name})`, `${L.categoryId} (${L.category?.name})`)
    }

    const [refs, rateChangeCount] = await Promise.all([
      hardRefs(pair.loserId),
      prisma.rateChangeLog.count({ where: { inventoryItemId: pair.loserId } }),
    ])
    const refTotal = Object.values(refs).reduce((a, b) => a + b, 0)
    if (refTotal > REPOINT_SANITY_CAP) {
      throw new Error(
        `[${pair.label}] loser ${pair.loserId} has ${refTotal} referencing rows ` +
          `(cap ${REPOINT_SANITY_CAP}). That is far more than surveyed — stop and look.`,
      )
    }

    plans.push({ pair, keeper: K, loser: L, keeperData: data, changes, refs, rateChangeCount })
  }

  // ── Report ──────────────────────────────────────────────────────
  for (const p of plans) {
    const { pair, keeper, loser, changes, refs, rateChangeCount } = p
    const refTotal = Object.values(refs).reduce((a, b) => a + b, 0)
    console.log('='.repeat(74))
    console.log(`${pair.label}`)
    console.log(`  ${pair.why}\n`)
    console.log(`  KEEP    ${keeper.id}`)
    console.log(`          "${keeper.description}"  code="${keeper.code}"  ${keeper.category?.name}`)
    console.log(changes.length ? changes.join('\n') : '    (no field changes — keeper already correct)')
    console.log(`\n  ARCHIVE ${loser.id}`)
    console.log(`          "${loser.description}"  code="${loser.code}"  ${loser.category?.name}`)
    console.log(`    isActive:  true  ->  false`)
    console.log(`    archivedAt: null  ->  <now>`)
    console.log(`    internalFlags: ${JSON.stringify(loser.internalFlags)}  ->  ` +
      `${JSON.stringify([...loser.internalFlags, `MERGED_INTO:${keeper.id}`])}`)
    console.log(`\n  references on loser: ${refTotal} ${JSON.stringify(refs)}`)
    if (refTotal > 0) console.log(`    -> will be re-pointed to ${keeper.id}`)
    console.log(`  rateChangeLog on loser: ${rateChangeCount} (left in place — audit history stays where it happened)`)
    console.log('')
  }

  if (!APPLY) {
    console.log('DRY RUN — pass --apply to commit.')
    await prisma.$disconnect()
    return
  }

  // ── Apply: one transaction per pair ─────────────────────────────
  for (const p of plans) {
    const { pair, keeper, loser, keeperData, refs } = p
    await prisma.$transaction(async (tx) => {
      // Re-point hard FKs. Zero rows at survey time; this is a safety net
      // for anything created between the survey and the run.
      if (refs.lineItems)
        await tx.orderLineItem.updateMany({ where: { inventoryItemId: loser.id }, data: { inventoryItemId: keeper.id } })
      if (refs.packageItems)
        await tx.packageItem.updateMany({ where: { inventoryItemId: loser.id }, data: { inventoryItemId: keeper.id } })
      if (refs.subRentals)
        await tx.subRental.updateMany({ where: { inventoryItemId: loser.id }, data: { inventoryItemId: keeper.id } })
      if (refs.assets)
        await tx.asset.updateMany({ where: { catalogItemId: loser.id }, data: { catalogItemId: keeper.id } })
      if (refs.bookingItems)
        await tx.bookingItem.updateMany({ where: { catalogItemId: loser.id }, data: { catalogItemId: keeper.id } })
      if (refs.vehicleCategories)
        await tx.vehicleCategory.updateMany({ where: { catalogItemId: loser.id }, data: { catalogItemId: keeper.id } })

      if (Object.keys(keeperData).length > 0)
        await tx.inventoryItem.update({ where: { id: keeper.id }, data: keeperData })

      await tx.inventoryItem.update({
        where: { id: loser.id },
        data: {
          isActive: false,
          archivedAt: new Date(),
          internalFlags: [...loser.internalFlags, `MERGED_INTO:${keeper.id}`],
        },
      })
    })
    console.log(`applied — ${pair.label}: kept ${keeper.id}, archived ${loser.id}`)
  }

  console.log(`\nDone (${TODAY}). ${plans.length} pairs merged.`)
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
