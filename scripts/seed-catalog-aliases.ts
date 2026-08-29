/**
 * Seed producer-speak aliases onto catalog rows.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/seed-catalog-aliases.ts            # preflight (no writes)
 *   npx tsx scripts/seed-catalog-aliases.ts --apply
 *
 * Idempotent: aliases are UNIONed onto the row by id, so re-running is a
 * no-op and nothing already curated is dropped.
 *
 * Why aliases and not matcher code: the fallback matcher scores a row on
 * the words the client actually used (src/lib/sales/catalogMatcher.ts).
 * When SirReel's name for a thing and the industry's name share no words —
 * "garment rack" vs "Wardrobe Rack, Rolling" — no amount of scoring closes
 * that gap, and the matcher correctly declines. An alias is where we write
 * down the translation. Adding one also lifts the row into the AI catalog
 * snippet (loadCatalogForSnippet takes every row with aliases), so the AI
 * gets a shot at it before the fallback ever runs.
 *
 * Targets are pinned by id, not by name lookup: several of these rows have
 * a near-duplicate twin (Rubbermaid Cart / Rubber Maid Cart) and a name
 * match would be a coin flip between them.
 */

import { prisma } from '../src/lib/prisma'

const APPLY = process.argv.includes('--apply')

interface AliasSeed {
  id: string
  /** Expected name — asserted before writing, so a re-pointed id fails loud. */
  name: string
  aliases: string[]
  /** Aliases to take OFF the row — a word can only default to one SKU. */
  remove?: string[]
  why: string
}

const SEEDS: AliasSeed[] = [
  {
    id: '75298e0e-9e2e-4c23-9196-bf13371085c0',
    name: 'Wardrobe Rack, Rolling',
    aliases: ['garment rack', 'clothing rack'],
    why: 'Wardrobe is our word for it; crews ask for a garment rack.',
  },
  {
    id: '36f41fda-884e-4850-b29b-685cb11c329b',
    name: 'Rubbermaid Cart',
    aliases: ['production cart', 'utility cart'],
    why: "Wes's ruling 2026-08-17: production/utility cart = the Rubbermaid.",
  },
  {
    id: '79f1a85d-97ac-4bbf-a6d5-c7e31fa7505b',
    name: 'Trash Liners, Roll',
    aliases: ['trash can liner', 'can liner', 'trash liner', 'trash bag', 'garbage bag'],
    why: 'Ordered alongside cans as "cans + liners"; the liner half needs its own row. "Trash bags" means these, not the disposal service (Wes, 8/17).',
  },
  // ── Walkies default to digital (Wes, 8/17) ──────────────────────
  // Both radios rent for the same $10/day, so this isn't a billing
  // question — it's which SKU lands on the pull sheet. The generic
  // vocabulary can only belong to one row, so the analog keeps only the
  // qualified forms and answers when the request actually says analog.
  {
    // Repointed 2026-08-17: the CP200d row and this one were the same
    // radio (Wes), so they were merged and the 21-unit CP200d archived.
    // The 91-unit RW-backed row is the survivor — the default walkie now
    // lands on it. See scripts/merge-cp200-digital-dup.ts.
    id: 'd61119ab-5af1-4de5-a601-28a22944a956',
    name: 'Motorola CP200  UHF Radio (Digital)',
    aliases: ['walkie', 'walkie talkie', 'handheld', 'two-way radio', 'two way radio', 'radio', 'cp200', 'cp200d'],
    // Plurals are dead weight — aliasHit() already allows a trailing s, and
    // an alias that fires twice on one description just inflates the score.
    remove: ['walkies', 'walkie talkies', 'handhelds', 'radios'],
    why: 'Default walkie. Digital unless the request says analog. Carries "cp200d" because the row that spelled it that way is now archived.',
  },
  {
    id: '61954d15-9592-453d-9d29-8f06a40cf5c8',
    name: 'Motorola CP200  UHF Radio (Analog)',
    aliases: ['analog', 'analog walkie', 'analog radio', 'cp200 analog', 'analogue'],
    remove: [
      'walkies', 'walkie', 'walkie talkie', 'walkie talkies', 'handheld',
      'handhelds', 'two-way radio', 'two way radio', 'radios', 'radio', 'cp200',
    ],
    why: 'Answers to "analog" only — the bare walkie words now belong to the digital row.',
  },
  {
    id: 'f2fa4a8f-43f1-4c2b-aca7-6e2445eb69f0',
    name: 'Trash Bag Disposal',
    aliases: ['trash bag disposal'],
    why: 'Defensive: "trash bag" now belongs to the liners, and alias score is alias length — spelling out the full service name keeps this row reachable by its own name.',
  },
  // ── Hanger dedupe (Wes, 2026-08-29) ─────────────────────────────
  // Three products had grown two or three catalog rows apiece — an
  // HQ-native EXP-HANGER-* row plus RentalWorks-era imports under the
  // industry's longer name, at different prices, in three different
  // departments. The duplicates are retired (isActive:false); these
  // aliases carry their names onto the survivor so a crew asking for a
  // "wardrobe hanger" or a "combo hanger 17 clear" still lands
  // somewhere instead of on an empty dropdown.
  {
    id: '9acd220a-5604-4ae8-98ce-ed71df6b0786',
    name: 'Hanger, Combo',
    aliases: ['combo hanger', 'wardrobe hanger', 'clear hanger', 'combo hanger 17 clear', 'hangers'],
    why: 'Absorbs retired HANGERC-RW ("Combo Hanger 17\" Clear, Each") and HANGERC ("Wardrobe Hanger 17\" Clear, Combo - Each"). Combo is the default hanger — a bare "hangers" means these.',
  },
  {
    id: 'd66d2f98-ec4c-4f2e-9978-02c283d6868c',
    name: 'Hanger, Pants',
    aliases: ['pant hanger', 'pants hanger', 'trouser hanger', 'clip hanger', 'pant hanger with clips'],
    why: 'Absorbs the retired "Wardrobe Hanger 17\" Clear, Pant w/ Clip - Each". The clip is what crews name it by.',
  },
  {
    id: '27dcef43-0caf-4bf4-81d7-82a8e7544f2f',
    name: 'Hanger, Shirts',
    aliases: ['shirt hanger', 'dress hanger', 'shirt dress hanger', 'blouse hanger'],
    why: 'Absorbs the retired "Wardrobe Hanger 17\" Clear, Shirt/Dress - Each".',
  },
]

async function main(): Promise<void> {
  let writes = 0
  for (const seed of SEEDS) {
    const row = await prisma.inventoryItem.findUnique({
      where: { id: seed.id },
      select: { id: true, description: true, code: true, aliases: true, isActive: true },
    })
    if (!row) {
      console.error(`MISSING  ${seed.id} (${seed.name}) — not in catalog, skipping`)
      continue
    }
    const name = row.description || row.code
    if (name !== seed.name) {
      console.error(`MISMATCH ${seed.id} — expected "${seed.name}", found "${name}". Skipping.`)
      continue
    }
    if (!row.isActive) console.error(`WARN     "${name}" is inactive — the matcher only reads active rows`)

    const drop = new Set(seed.remove ?? [])
    const merged = [...new Set([...row.aliases, ...seed.aliases])].filter((a) => !drop.has(a))
    const added = merged.filter((a) => !row.aliases.includes(a))
    const removed = row.aliases.filter((a) => drop.has(a))
    if (added.length === 0 && removed.length === 0) {
      console.log(`unchanged  ${name}  [${row.aliases.join(', ')}]`)
      continue
    }
    const delta = [
      added.length > 0 ? `+ ${added.join(', ')}` : '',
      removed.length > 0 ? `− ${removed.join(', ')}` : '',
    ].filter(Boolean).join('  ')
    console.log(`${APPLY ? 'writing  ' : 'would edit'}  ${name}  ${delta}`)
    if (APPLY) {
      await prisma.inventoryItem.update({ where: { id: row.id }, data: { aliases: merged } })
      writes++
    }
  }
  console.log(APPLY ? `\n${writes} row(s) updated` : '\npreflight only — re-run with --apply')
  await prisma.$disconnect()
}

main()
