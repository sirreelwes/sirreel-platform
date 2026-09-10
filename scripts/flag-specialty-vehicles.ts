/**
 * Put the Specialty Vehicles class on the rows that belong to it.
 *
 * Wes 2026-09-10: "motorhomes and wardrobe makeup trailers are all going
 * to be in the Specialty Vehicles category" — motorhomes / star wagons,
 * wardrobe, hair & makeup, honeywagon, star/talent, production trailers
 * and the restroom trailers.
 *
 * TWO FIELDS, two different questions (see the schema comments):
 *   • VehicleCategory.isSpecialtyVehicle — where the card renders on the
 *     public /vehicles page.
 *   • InventoryItem.isSpecialtyVehicle  — how an order line BILLS: no
 *     LCDW, per-mile from the first mile, calendar days with no weekly
 *     cap.
 *
 * Rows are named by SLUG / CODE, never by a LIKE pattern, and the run
 * journals every id it touched with its before value so the change is
 * reversible by captured id.
 *
 *   npx tsx scripts/flag-specialty-vehicles.ts            # dry run
 *   npx tsx scripts/flag-specialty-vehicles.ts --write
 */
import { prisma } from '../src/lib/prisma'
import { writeFileSync, mkdirSync } from 'fs'

/** Public catalog rows that move into the Specialty Vehicles section. */
const CATEGORY_SLUGS = [
  'production-trailer',
  'honeywagon',
  'star-talent-trailer',
  'hair-makeup-trailer',
  'wardrobe-trailer',
  // The restroom trailer's slug is 'dlux', not its display name — the
  // public URL predates the rename and is what clients have bookmarked.
  'dlux',
]

/**
 * Catalog rows whose LINES bill as specialty. Only the restroom trailers
 * are catalogued today — the trailer families have no InventoryItem at
 * all, and a partner's coach reaches an order through a SubRental, which
 * the predicate already recognises structurally.
 */
const CATALOG_CODES = ['CAT_DLUX', 'CAT_DLUX_NORCAL']

async function main() {
  const write = process.argv.includes('--write')

  const cats = await prisma.vehicleCategory.findMany({
    where: { slug: { in: CATEGORY_SLUGS } },
    select: { id: true, name: true, slug: true, isSpecialtyVehicle: true },
  })
  const items = await prisma.inventoryItem.findMany({
    where: { code: { in: CATALOG_CODES } },
    select: { id: true, code: true, description: true, isSpecialtyVehicle: true },
  })

  const missingCats = CATEGORY_SLUGS.filter((s) => !cats.find((c) => c.slug === s))
  const missingItems = CATALOG_CODES.filter((c) => !items.find((i) => i.code === c))

  console.log(`— VehicleCategory (public section) —`)
  for (const c of cats) console.log(`  ${c.isSpecialtyVehicle ? 'already' : 'SET   '}  ${c.slug.padEnd(26)} ${c.name}`)
  if (missingCats.length) console.log(`  NOT FOUND: ${missingCats.join(', ')}`)

  console.log(`\n— InventoryItem (billing class) —`)
  for (const i of items) console.log(`  ${i.isSpecialtyVehicle ? 'already' : 'SET   '}  ${i.code.padEnd(26)} ${i.description}`)
  if (missingItems.length) console.log(`  NOT FOUND: ${missingItems.join(', ')}`)

  if (!write) {
    console.log('\nDry run. Re-run with --write to apply.')
    return
  }

  const journal = {
    ranAt: new Date().toISOString(),
    reason: 'Wes 2026-09-10 — motorhomes and wardrobe/makeup trailers into Specialty Vehicles',
    // Before values, by captured id — this is what a revert reads.
    vehicleCategories: cats.map((c) => ({ id: c.id, slug: c.slug, was: c.isSpecialtyVehicle })),
    inventoryItems: items.map((i) => ({ id: i.id, code: i.code, was: i.isSpecialtyVehicle })),
    notFound: { categorySlugs: missingCats, catalogCodes: missingItems },
  }

  // By captured id only. Never a pattern update — the ids above are the
  // rows this run read, and nothing else may be touched.
  for (const c of cats) {
    if (c.isSpecialtyVehicle) continue
    await prisma.vehicleCategory.update({ where: { id: c.id }, data: { isSpecialtyVehicle: true } })
  }
  for (const i of items) {
    if (i.isSpecialtyVehicle) continue
    await prisma.inventoryItem.update({ where: { id: i.id }, data: { isSpecialtyVehicle: true } })
  }

  mkdirSync('journals', { recursive: true })
  const path = `journals/flag-specialty-vehicles-${journal.ranAt.replace(/[:.]/g, '-')}.json`
  writeFileSync(path, JSON.stringify(journal, null, 2))
  console.log(`\nWrote ${path}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
