/**
 * Clean up legacy Utah-prefixed InventoryItem rows.
 *
 * The Utah location is permanently closed. Physical inventory has
 * already been consolidated into the Sun Valley (LANKERSHIM) counts
 * upstream, so the 41 `UTAH - …` rows in InventoryItem are pure
 * DB cruft. This seed reassigns every foreign-key reference from
 * each Utah row to its canonical (non-Utah) counterpart, then
 * hard-deletes the Utah row.
 *
 * MATCHING:
 *   - Utah rows are identified by `code` OR `description` starting
 *     with "UTAH" (case-insensitive). One row in the wild has a
 *     non-Utah code (104406) but a Utah description — both have
 *     to be caught.
 *   - Canonical match = strip "UTAH - " (case-insensitive) from the
 *     description, then look up an InventoryItem whose description
 *     equals the stripped value AND whose description does NOT
 *     itself start with "UTAH".
 *   - Multiple-match (description ambiguity) is treated as "no
 *     canonical found" — safer to flag for manual review than to
 *     pick one arbitrarily.
 *
 * FOREIGN KEYS (verified against prisma/schema.prisma):
 *   - OrderLineItem.inventoryItemId  (nullable, no cascade)
 *   - SubRental.inventoryItemId       (nullable, no cascade)
 * No other model holds a reference. InventoryCategory and
 * InventoryLocation have InventoryItem[] back-relations (the parent
 * side); deleting a child is safe with respect to those.
 *
 * QTY: physical counts are assumed already consolidated. This seed
 * does NOT bump the canonical's qtyOwned to absorb the Utah's
 * qtyOwned. The Utah qty is discarded.
 *
 * SAFETY:
 *   - Per-row reassign + delete wrapped in a transaction. Partial
 *     reassignment failures abort cleanly.
 *   - DRY RUN by default. Set DRY_RUN=0 to actually execute.
 *
 * Run:
 *   # Preview (default)
 *   npx dotenv -e .env.local -- npx tsx prisma/seeds/2026-05-11-utah-inventory-cleanup.ts
 *
 *   # Execute after reviewing
 *   DRY_RUN=0 npx dotenv -e .env.local -- npx tsx prisma/seeds/2026-05-11-utah-inventory-cleanup.ts
 */

import { prisma } from '../../src/lib/prisma'

const DRY_RUN = process.env.DRY_RUN !== '0'

interface UtahRow {
  id: string
  code: string
  description: string | null
  qtyOwned: number
}

interface CanonicalRow {
  id: string
  code: string
  description: string | null
}

function strippedDescription(desc: string | null): string | null {
  if (!desc) return null
  // Normalize: "UTAH - X" / "utah  -  x" / "Utah-X" → "X"
  const m = desc.match(/^\s*utah\s*[-—]\s*(.+)$/i)
  if (m) return m[1].trim()
  return null
}

async function findCanonical(utah: UtahRow): Promise<{ row: CanonicalRow | null; ambiguous: boolean }> {
  const canonDesc = strippedDescription(utah.description)
  if (!canonDesc) return { row: null, ambiguous: false }
  const candidates = await prisma.inventoryItem.findMany({
    where: {
      description: { equals: canonDesc, mode: 'insensitive' },
      id: { not: utah.id },
      // Exclude other Utah rows so we don't accidentally chain-reassign.
      NOT: { description: { startsWith: 'UTAH', mode: 'insensitive' } },
    },
    select: { id: true, code: true, description: true },
    take: 3,
  })
  if (candidates.length === 0) return { row: null, ambiguous: false }
  if (candidates.length > 1) return { row: null, ambiguous: true }
  return { row: candidates[0], ambiguous: false }
}

async function main() {
  console.log(DRY_RUN ? '── DRY RUN — no writes ──' : '── EXECUTE — writes enabled ──')
  console.log()

  const utah: UtahRow[] = await prisma.inventoryItem.findMany({
    where: {
      OR: [
        { code: { startsWith: 'UTAH', mode: 'insensitive' } },
        { description: { startsWith: 'UTAH', mode: 'insensitive' } },
      ],
    },
    select: { id: true, code: true, description: true, qtyOwned: true },
    orderBy: { code: 'asc' },
  })
  console.log(`Found ${utah.length} Utah-prefixed InventoryItem rows`)
  console.log()

  let reassigned = 0
  let deleted = 0
  let skippedNoMatch = 0
  let skippedAmbiguous = 0
  let errored = 0

  for (let i = 0; i < utah.length; i++) {
    const u = utah[i]
    const prefix = `[${i + 1}/${utah.length}]`
    const { row: canon, ambiguous } = await findCanonical(u)

    if (ambiguous) {
      skippedAmbiguous++
      console.log(`${prefix} ? AMBIGUOUS  ${u.description}  — multiple canonical matches, skipping`)
      continue
    }
    if (!canon) {
      skippedNoMatch++
      console.log(`${prefix} ⊘ NO MATCH   ${u.description}`)
      continue
    }

    const olCount = await prisma.orderLineItem.count({ where: { inventoryItemId: u.id } })
    const srCount = await prisma.subRental.count({ where: { inventoryItemId: u.id } })

    const action = DRY_RUN ? 'WOULD ' : ''
    console.log(
      `${prefix} ✓ ${action}REASSIGN  '${u.description}'  →  '${canon.description}' (code=${canon.code})  ` +
      `[${olCount} order_line_items, ${srCount} sub_rentals]`,
    )

    if (DRY_RUN) {
      reassigned += olCount + srCount
      deleted++
      continue
    }

    try {
      await prisma.$transaction(async (tx) => {
        if (olCount > 0) {
          await tx.orderLineItem.updateMany({
            where: { inventoryItemId: u.id },
            data: { inventoryItemId: canon.id },
          })
        }
        if (srCount > 0) {
          await tx.subRental.updateMany({
            where: { inventoryItemId: u.id },
            data: { inventoryItemId: canon.id },
          })
        }
        await tx.inventoryItem.delete({ where: { id: u.id } })
      })
      reassigned += olCount + srCount
      deleted++
    } catch (err) {
      errored++
      console.log(`${prefix} ✗ ERRORED on '${u.code}': ${err instanceof Error ? err.message : err}`)
    }
  }

  console.log()
  console.log('───── SUMMARY ─────')
  console.log(`Mode:              ${DRY_RUN ? 'DRY RUN (no writes)' : 'EXECUTE (writes committed)'}`)
  console.log(`Utah rows found:   ${utah.length}`)
  console.log(`FK refs ${DRY_RUN ? 'would be' : ''} reassigned: ${reassigned}`)
  console.log(`Utah rows ${DRY_RUN ? 'would be' : ''} deleted: ${deleted}`)
  console.log(`Skipped — no canonical match:  ${skippedNoMatch}`)
  console.log(`Skipped — ambiguous match:     ${skippedAmbiguous}`)
  console.log(`Errored:                        ${errored}`)
  if (DRY_RUN) {
    console.log()
    console.log('Run again with DRY_RUN=0 to commit.')
  }

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
