/**
 * Point barcoded units at the catalog row people can actually order.
 *
 * Wes, 2026-09-18, listing what carries a barcode in the yard: steamers,
 * mirrors, worklights, lunchboxes, magliners, ecoflow, canopies,
 * generators, hazers, steel deck, propane heaters, RE fans, the lights.
 * Almost all of it was already scannable. Three of his items were not,
 * for the same structural reason each time: RW's register has the units,
 * but the ICode they carry resolves to a row nobody can book — either an
 * ARCHIVED twin of the live row, or no HQ row at all. A line booked on
 * the live row then shows no scanner on the check sheet, and the barcode
 * has nowhere to land.
 *
 * This is the same defect `dedupe-rw-icode-catalog-rows.ts` fixed on
 * 2026-09-13 for rows that SHARED an rwICode. These four never shared
 * one: the live row's rwICode was simply null (or, for EcoFlow, a
 * catalog code rather than the item-register ICode).
 *
 * What it does per entry, all inside one transaction:
 *   1. sets `rwICode` on the live, orderable row;
 *   2. CLEARS `rwICode` on any other row carrying that code, so the
 *      nightly sync cannot resolve back to the archived twin (it reads
 *      every row with the code and takes one — since 2026-09-18 it
 *      prefers an orderable one, and this removes the ambiguity as well);
 *   3. repoints the existing `InventoryUnit` rows at the live row, so
 *      scanning works now rather than after tonight's 09:00 UTC cron.
 *
 * Nothing is deleted, no quantity is touched (a count is a shelf count —
 * see project_rw_icode_duplicate_rows), and the BEFORE state of every
 * row it writes is journalled by id.
 *
 *   npx tsx scripts/link-barcoded-catalog-rows.ts            # dry run
 *   npx tsx scripts/link-barcoded-catalog-rows.ts --write
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface Link {
  /** RW item-register ICode the barcoded units carry. */
  icode: string
  /** `InventoryItem.code` of the live row lines are booked against. */
  code: string
  /** Why this pairing is not a guess. */
  why: string
}

/**
 * Deliberately a short, named list. Every entry is one a human can check
 * against a shelf — RW's description and HQ's are the same product, and
 * where both carry a count, the counts agree. Three cases that look the
 * same are NOT here because the right row is not derivable:
 *
 *   - 105020 "Internet - T-Mobile MiFi (5G)" (20 units) — HQ's live MiFi
 *     rows are Verizon and AT&T, and 104402 (Verizon) already holds 19
 *     units of its own. Which carrier this is belongs to whoever stocks it.
 *   - 105159 "Jumper Box" (8 units) — HQ has no catalog row at all.
 *   - 104430 "Leaf Blower - Plug In" (4 units) — HQ has a live "Leaf
 *     Blower, Electric" (qty 0), a live Milwaukee M18 row that already
 *     has its own units, and two archived plug-in rows.
 */
const LINKS: Link[] = [
  {
    icode: '103845',
    code: 'CLI-HEATER-PROPANE',
    why: '18 barcoded "Heater - Mobile Propane" against HQ\'s "Heater, Propane", qty 18 — no HQ row carried the ICode at all',
  },
  {
    icode: '104401',
    code: 'CLI-MISTERS-10-GALLON',
    why: '9 barcoded "Mister - 10 Gallon" against HQ\'s "Misters, 10 gallon", qty 9 — the ICode sat on an archived twin',
  },
  {
    icode: '103828',
    code: 'ECOFLOW',
    why: '2 barcoded "ECOFLOW DELTA 3 ULTRA 3.6K" — the only EcoFlow in either system; HQ\'s row carried the catalog code ECOFLOW, not the register ICode',
  },
  {
    icode: '104593',
    code: 'DOL-DOLLY-MAGLINER-SR-W-SHELF',
    why: '3 barcoded "Dolly - Magliner Sr with Shelf" against the identically named live row; the ICode sat on an archived twin',
  },
]

async function main() {
  const write = process.argv.includes('--write')
  const journal: unknown[] = []
  let unitsRepointed = 0

  for (const link of LINKS) {
    const live = await prisma.inventoryItem.findFirst({
      where: { code: link.code },
      select: { id: true, code: true, description: true, rwICode: true, archivedAt: true, qtyOwned: true },
    })
    if (!live) { console.log(`SKIP ${link.icode} — no catalog row with code ${link.code}`); continue }
    if (live.archivedAt) { console.log(`SKIP ${link.icode} — ${link.code} is archived; un-archive it first`); continue }

    const others = await prisma.inventoryItem.findMany({
      where: { rwICode: link.icode, id: { not: live.id } },
      select: { id: true, code: true, description: true, archivedAt: true, rwICode: true },
    })
    const units = await prisma.inventoryUnit.count({ where: { rwICode: link.icode } })
    const active = await prisma.inventoryUnit.count({ where: { rwICode: link.icode, inactive: false } })

    console.log(
      `\n${link.icode} → ${live.code}  "${live.description}"\n` +
      `  ${units} units (${active} active) · ${link.why}\n` +
      `  rwICode ${live.rwICode ?? '—'} → ${link.icode}` +
      (others.length ? `\n  clearing rwICode on: ${others.map((o) => `${o.code}${o.archivedAt ? '[archived]' : ' [LIVE]'}`).join(', ')}` : ''),
    )

    journal.push({
      icode: link.icode,
      live: { id: live.id, code: live.code, rwICodeBefore: live.rwICode },
      cleared: others.map((o) => ({ id: o.id, code: o.code, rwICodeBefore: o.rwICode, archived: !!o.archivedAt })),
      unitCount: units,
    })
    if (!write) continue

    await prisma.$transaction(async (tx) => {
      for (const o of others) {
        await tx.inventoryItem.update({ where: { id: o.id }, data: { rwICode: null } })
      }
      await tx.inventoryItem.update({ where: { id: live.id }, data: { rwICode: link.icode } })
      const moved = await tx.inventoryUnit.updateMany({
        where: { rwICode: link.icode },
        data: { inventoryItemId: live.id },
      })
      unitsRepointed += moved.count
      await tx.auditLog.create({
        data: {
          action: 'inventory_item.link_barcoded_units',
          entityType: 'InventoryItem',
          entityId: live.id,
          oldValues: { rwICode: live.rwICode, clearedFrom: others.map((o) => ({ id: o.id, code: o.code })) },
          newValues: { rwICode: link.icode, unitsRepointed: moved.count, why: link.why },
        },
      })
    })
  }

  if (write) {
    const dir = path.join(process.cwd(), 'journals')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `link-barcoded-catalog-rows-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    fs.writeFileSync(file, JSON.stringify({ ranAt: new Date().toISOString(), entries: journal }, null, 2))
    console.log(`\nWROTE ${LINKS.length} links · ${unitsRepointed} units repointed · journal ${path.relative(process.cwd(), file)}`)
  } else {
    console.log('\nDRY RUN — nothing written. Re-run with --write.')
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
