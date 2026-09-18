/**
 * Give the live first-aid-kit row the aliases it needs to be findable.
 *
 * Found 2026-09-18 by `npm run test:catalog-match`, which had two failing
 * first-aid cases. Both trace back to the 2026-09-13 duplicate-rwICode
 * cleanup (project_rw_icode_duplicate_rows): the row the test named,
 * `First Aid Kit "50 Person"`, is ARCHIVED and holds 0 units, while the
 * live orderable row is SAF-1ST-AID-KIT-50-PERSON "1st Aid Kit, 50
 * person" (rwICode 104427, 12 barcoded units). The stale expectation was
 * just a name; the real gap is that the live row carries NO aliases, and
 * its name says "1st" where every client writes "first":
 *
 *   "first aid kit"  → matched, but only on the two words the two spellings
 *                      happen to share (aid, kit) — 2/3 coverage, one token
 *                      from being rejected.
 *   "First-aid kit"  → matched NOTHING. tokenize() splits the hyphen, so
 *                      "first" is its own token the name cannot explain,
 *                      coverage falls to 1/2 and fallbackMatch's 0.6
 *                      evidence floor declines the row outright.
 *
 * A curated alias fixes both directions at once: it lands on the head noun
 * ("kit"), which satisfies the alias+head half of the evidence test on its
 * own, and it carries the hyphenated spelling the catalog name never will.
 *
 * ALIASES ARE SEED-OWNED. The same list lives in
 * prisma/seeds/2026-05-08-catalog-aliases.ts (INVENTORY_ALIASES,
 * codeContains '1ST-AID-KIT') so the next seed run re-applies it rather
 * than wiping it — keep the two in step. This script exists because that
 * seed ALSO re-infers `department` on every catalog row and runs two
 * ALTER TABLE statements, and departments are not a thing to disturb for
 * one alias list (memory: project_department_reflattening).
 *
 * Narrow by construction: one row, matched by exact code, `aliases` the
 * only column written. Nothing is deleted, no count is touched, and the
 * BEFORE value of every row it writes is journalled by captured id and
 * mirrored into an AuditLog row.
 *
 *   npx tsx scripts/alias-first-aid-kit.ts            # dry run
 *   npx tsx scripts/alias-first-aid-kit.ts --write
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface AliasPatch {
  /** `InventoryItem.code` — exact, so this can only ever hit one row. */
  code: string
  aliases: string[]
  /** Why this row and not its archived twins. */
  why: string
}

/**
 * Deliberately one entry. Spellings only — every alias here is a way
 * somebody writes THIS product's name. Nothing adjacent ("medical kit",
 * "burn kit") is included: a first aid kit is not evidence that we stock
 * whatever else the phrase might mean, and a wrong alias prices a client's
 * line off another row's rate with nothing in the UI to flag it (the "ac"
 * -inside-"garment racks" lesson that put word boundaries on aliasHit).
 *
 * Verified 2026-09-18 against the live catalog: no other ACTIVE row's name
 * or aliases contain any of these strings, and no existing alias on any
 * row fires on "first aid kit" or "first-aid kit".
 */
const PATCHES: AliasPatch[] = [
  {
    code: 'SAF-1ST-AID-KIT-50-PERSON',
    aliases: [
      'first aid kit', 'first-aid kit', 'first aid', 'first-aid',
      '1st aid kit', '1st aid', 'aid kit',
    ],
    why: 'the live, orderable first-aid row (rwICode 104427, 12 barcoded units); its two twins — code "104427" and code \'First Aid Kit "50 Person"\' — are archived with 0 units and 0 barcoded units',
  },
]

async function main() {
  const write = process.argv.includes('--write')
  const journal: unknown[] = []

  for (const patch of PATCHES) {
    const row = await prisma.inventoryItem.findFirst({
      where: { code: patch.code },
      select: {
        id: true, code: true, description: true, aliases: true,
        isActive: true, archivedAt: true, qtyOwned: true,
      },
    })
    if (!row) {
      console.log(`SKIP ${patch.code} — no catalog row with that code`)
      continue
    }
    // An archived row is unreachable by fallbackMatch (`isActive: true`),
    // so aliasing one is at best inert and at worst hides that the live
    // row still has none. Refuse rather than write somewhere useless.
    if (!row.isActive || row.archivedAt) {
      console.log(
        `SKIP ${patch.code} — archived (archivedAt ${row.archivedAt?.toISOString().slice(0, 10) ?? 'null'}, ` +
        `isActive ${row.isActive}); the matcher only sees active rows, so the alias would do nothing`
      )
      continue
    }

    const same =
      row.aliases.length === patch.aliases.length &&
      patch.aliases.every((a) => row.aliases.includes(a))

    console.log(
      `\n${row.code}  "${row.description}"\n` +
      `  qty ${row.qtyOwned} · ${patch.why}\n` +
      `  aliases [${row.aliases.join(', ') || '—'}]\n` +
      `       → [${patch.aliases.join(', ')}]` +
      (same ? '\n  ALREADY SET — nothing to do' : '')
    )
    if (same) continue

    journal.push({
      id: row.id,
      code: row.code,
      description: row.description,
      aliasesBefore: row.aliases,
      aliasesAfter: patch.aliases,
      why: patch.why,
    })
    if (!write) continue

    await prisma.$transaction(async (tx) => {
      await tx.inventoryItem.update({
        where: { id: row.id },
        data: { aliases: patch.aliases },
      })
      await tx.auditLog.create({
        data: {
          action: 'inventory_item.aliases_set',
          entityType: 'InventoryItem',
          entityId: row.id,
          oldValues: { aliases: row.aliases },
          newValues: { aliases: patch.aliases, why: patch.why },
        },
      })
    })
  }

  if (!write) {
    console.log('\nDRY RUN — nothing written. Re-run with --write.')
    return
  }
  if (journal.length === 0) {
    console.log('\nNothing to write — every row already carries its aliases.')
    return
  }
  const dir = path.join(process.cwd(), 'journals')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `alias-first-aid-kit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(file, JSON.stringify({ ranAt: new Date().toISOString(), entries: journal }, null, 2))
  console.log(`\nWROTE ${journal.length} row(s) · journal ${path.relative(process.cwd(), file)}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
