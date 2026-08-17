#!/usr/bin/env tsx
/**
 * Restore the generic walkie aliases to the 287-unit CP200 Analog row.
 *
 * Background:
 *   catalogMatcher.fallbackMatch is built on the assumption that every
 *   CP200 variant carries the same generic alias set, and that the
 *   tiebreak then picks the LA Analog row — see the comment at the
 *   pool.sort() call: "Tie-break is what unblocks 'walkies' when 4 CP200
 *   variants score identically."
 *
 *   A 2026-08-17 14:14 edit replaced the generic set on the Analog row
 *   (61954d15, 287 units) with analog-SPECIFIC aliases — analog, analog
 *   walkie, analog radio, cp200 analog, analogue — while leaving the
 *   generic set on CP200d (f7ef9d54, 21 units). That left CP200d as the
 *   only row scoring on a bare "walkies", so the highest-volume item in
 *   the catalog stopped being reachable by the word crews actually use,
 *   and tests/sales/catalog-match.test.ts started failing:
 *
 *     FAIL — "walkies" → Motorola CP200  UHF Radio (Analog)
 *            [got: Motorola CP200d  UHF Radio (Digital)]
 *
 *   This restores the generics as a UNION with the analog-specific ones,
 *   so the 14:14 work is preserved, not reverted.
 *
 * Why this resolves cleanly rather than by tiebreak:
 *   aliasHit() matches an optional plural suffix, so both "walkie" and
 *   "walkies" fire on the description "walkies", and score is the sum of
 *   matched alias LENGTHS. Analog scores 7 + 6 = 13; CP200d carries only
 *   the singular, scoring 6. 13 clears the >2x lead rule outright.
 *
 * Alias set:
 *   Taken verbatim from the three archived CP200 rows that still carry
 *   the pre-14:14 generic set (UTAH analog a5773551, UTAH digital
 *   7307e12e, and the curated COM-MOTOROLA-CP200-RADIO 9cb18a34), so
 *   this matches the house convention rather than inventing one. The
 *   singular/plural redundancy ("walkie" + "walkies") is deliberate and
 *   is how every other seeded row is written.
 *
 * Scope:
 *   ONE row. f7ef9d54 (CP200d, 21u) keeps its generic aliases and is not
 *   touched — deduplicating the generics across the CP200 family is part
 *   of the wider radio-family question (Analog 287 / Digital 91 / CP200d
 *   21 / Sub 0), which is still open.
 *
 * Usage:
 *   npx tsx scripts/fix-cp200-analog-aliases.ts           # dry run
 *   npx tsx scripts/fix-cp200-analog-aliases.ts --apply   # commit
 *
 * Reverse:
 *   UPDATE inventory_items
 *      SET aliases = '{analog,"analog walkie","analog radio","cp200 analog",analogue}'
 *    WHERE id = '61954d15-9592-453d-9d29-8f06a40cf5c8';
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

const ANALOG_ID = '61954d15-9592-453d-9d29-8f06a40cf5c8'
/** Source rows for the canonical generic set — all archived, read-only here. */
const GENERIC_SOURCE_ID = '9cb18a34-b15f-4dbb-b716-efc01e14ac1a'

/** Pre-state guard — the catalog is being edited by hand today. */
const EXPECT = {
  description: 'Motorola CP200  UHF Radio (Analog)',
  qtyOwned: 287,
  isActive: true,
  aliases: ['analog', 'analog walkie', 'analog radio', 'cp200 analog', 'analogue'],
}

async function main() {
  console.log(`CP200 Analog alias restore — ${APPLY ? 'LIVE WRITE' : 'DRY RUN'}\n`)

  const [row, genericSource] = await Promise.all([
    prisma.inventoryItem.findUnique({
      where: { id: ANALOG_ID },
      select: { id: true, description: true, qtyOwned: true, isActive: true, aliases: true },
    }),
    prisma.inventoryItem.findUnique({
      where: { id: GENERIC_SOURCE_ID },
      select: { id: true, description: true, aliases: true, isActive: true },
    }),
  ])

  if (!row) throw new Error(`Analog row ${ANALOG_ID} not found.`)
  if (!genericSource) throw new Error(`Generic-alias source ${GENERIC_SOURCE_ID} not found.`)

  const drift: string[] = []
  if (row.description !== EXPECT.description)
    drift.push(`description: expected ${JSON.stringify(EXPECT.description)}, found ${JSON.stringify(row.description)}`)
  if (row.qtyOwned !== EXPECT.qtyOwned)
    drift.push(`qtyOwned: expected ${EXPECT.qtyOwned}, found ${row.qtyOwned}`)
  if (row.isActive !== EXPECT.isActive)
    drift.push(`isActive: expected ${EXPECT.isActive}, found ${row.isActive}`)
  if (JSON.stringify(row.aliases) !== JSON.stringify(EXPECT.aliases))
    drift.push(`aliases: expected ${JSON.stringify(EXPECT.aliases)}, found ${JSON.stringify(row.aliases)}`)
  if (drift.length) {
    throw new Error(
      `${ANALOG_ID} has drifted since this fix was written:\n` +
        drift.map((d) => `    - ${d}`).join('\n') +
        `\n  Someone is editing these aliases. Re-check before running.`,
    )
  }

  // Union: analog-specific first (preserving the 14:14 edit), then any
  // generic the row is missing, in the source row's own order.
  const have = new Set(row.aliases.map((a) => a.toLowerCase()))
  const added = genericSource.aliases.filter((a) => !have.has(a.toLowerCase()))
  const next = [...row.aliases, ...added]

  console.log(`  ${row.id}  "${row.description}"  qty=${row.qtyOwned}`)
  console.log(`  generic set sourced from ${genericSource.id} ("${genericSource.description}", archived)\n`)
  console.log(`  aliases before (${row.aliases.length}): ${JSON.stringify(row.aliases)}`)
  console.log(`  adding         (${added.length}): ${JSON.stringify(added)}`)
  console.log(`  aliases after  (${next.length}): ${JSON.stringify(next)}\n`)

  if (added.length === 0) {
    console.log('Nothing to add — row already carries the generic set.')
    await prisma.$disconnect()
    return
  }

  if (!APPLY) {
    console.log('DRY RUN — pass --apply to commit.')
    await prisma.$disconnect()
    return
  }

  await prisma.inventoryItem.update({ where: { id: ANALOG_ID }, data: { aliases: next } })
  console.log(`Applied. ${ANALOG_ID} now carries ${next.length} aliases.`)
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
