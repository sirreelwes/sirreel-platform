/**
 * Seed for the ProductionTypeProfile lookup table.
 *
 * Upserts by slug — idempotent. Safe to re-run; later commits adding
 * profiles for new categories can append rows here without touching
 * the existing eight.
 *
 * Run with:
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx prisma/seeds/productionTypeProfiles.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface SeedRow {
  name: string
  slug: string
  tier: number
  upsellPropensity: number
  priceSensitivity: number
  salesMode: string
  sortOrder: number
}

// Order matches the brief verbatim — sortOrder controls UI display.
// tier 5 = newest gear pool, tier 1 = oldest.
// upsellPropensity 5 = high (commercial spends), 1 = none (vertical / indie).
// priceSensitivity 5 = very sensitive (indie / vertical), 1 = premium-tolerant.
const ROWS: SeedRow[] = [
  { name: 'Commercial',  slug: 'commercial',  tier: 5, upsellPropensity: 5, priceSensitivity: 1, salesMode: 'WHITE_GLOVE',  sortOrder: 10 },
  { name: 'Corporate',   slug: 'corporate',   tier: 5, upsellPropensity: 4, priceSensitivity: 1, salesMode: 'HIGHER_TOUCH', sortOrder: 20 },
  { name: 'Music Video', slug: 'music-video', tier: 4, upsellPropensity: 4, priceSensitivity: 3, salesMode: 'HIGHER_TOUCH', sortOrder: 30 },
  { name: 'Stills',      slug: 'stills',      tier: 4, upsellPropensity: 3, priceSensitivity: 3, salesMode: 'SEMI_AUTO',    sortOrder: 40 },
  { name: 'Episodic-TV', slug: 'episodic-tv', tier: 3, upsellPropensity: 3, priceSensitivity: 3, salesMode: 'SEMI_AUTO',    sortOrder: 50 },
  { name: 'Feature',     slug: 'feature',     tier: 2, upsellPropensity: 2, priceSensitivity: 3, salesMode: 'SEMI_AUTO',    sortOrder: 60 },
  { name: 'Indie',       slug: 'indie',       tier: 2, upsellPropensity: 1, priceSensitivity: 5, salesMode: 'LIGHT_TOUCH',  sortOrder: 70 },
  { name: 'Vertical',    slug: 'vertical',    tier: 1, upsellPropensity: 1, priceSensitivity: 5, salesMode: 'FULL_AUTO',    sortOrder: 80 },
]

async function main() {
  let created = 0
  let updated = 0
  for (const row of ROWS) {
    const existing = await prisma.productionTypeProfile.findUnique({
      where: { slug: row.slug },
      select: { id: true },
    })
    await prisma.productionTypeProfile.upsert({
      where: { slug: row.slug },
      create: { ...row, active: true },
      update: {
        name: row.name,
        tier: row.tier,
        upsellPropensity: row.upsellPropensity,
        priceSensitivity: row.priceSensitivity,
        salesMode: row.salesMode,
        sortOrder: row.sortOrder,
        // Don't flip active=true on an admin-deactivated row; only
        // create-path sets it.
      },
    })
    if (existing) updated++
    else created++
  }
  console.log(`production_type_profiles seed: created=${created}, updated=${updated}, total=${ROWS.length}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
