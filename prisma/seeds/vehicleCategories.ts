/**
 * Seed for the VehicleCategory customer-facing catalog tile lookup.
 *
 * Upsert by slug — idempotent. Safe to re-run. Update path preserves
 * admin-edited dailyRate / photoUrl / subtitle (commit-1-empty
 * values stay null but post-launch admin edits aren't clobbered) by
 * only writing fields whose seed-row value is non-null AND non-
 * default (name + sortOrder always written; subtitle written only
 * when the seed declares one).
 *
 * dailyRate and photoUrl are left null at seed time — content team
 * populates via admin UI once it lands.
 *
 * Run with:
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx prisma/seeds/vehicleCategories.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface SeedRow {
  name: string
  slug: string
  sortOrder: number
  subtitle?: string
}

// Order matches the brief verbatim; sortOrder gaps (80 → 100 leaves
// room at 90) preserved as-given so content team can slot rows
// between sections without renumbering.
const ROWS: SeedRow[] = [
  { name: 'Cargo Van',                       slug: 'cargo-van',                  sortOrder: 10 },
  { name: 'Cargo w/Lift Gate',               slug: 'cargo-w-liftgate',           sortOrder: 20 },
  { name: 'PopVan',                          slug: 'popvan',                     sortOrder: 30 },
  { name: 'Video Van / ProScout Sprinter',   slug: 'video-van-proscout',         sortOrder: 40 },
  { name: '12-Passenger Van',                slug: '12-passenger-van',           sortOrder: 50 },
  { name: '15-Passenger Van',                slug: '15-passenger-van',           sortOrder: 60 },
  { name: 'Cube Truck',                      slug: 'cube-truck',                 sortOrder: 70 },
  { name: 'Supercube',                       slug: 'supercube',                  sortOrder: 80,  subtitle: 'Liftgate' },
  { name: 'Production Trailer',              slug: 'production-trailer',         sortOrder: 100 },
  { name: 'Honeywagon',                      slug: 'honeywagon',                 sortOrder: 110 },
  { name: 'Star / Talent Trailer',           slug: 'star-talent-trailer',        sortOrder: 120 },
  { name: 'Hair / Makeup Trailer',           slug: 'hair-makeup-trailer',        sortOrder: 130 },
  { name: 'Wardrobe Trailer',                slug: 'wardrobe-trailer',           sortOrder: 140 },
]

async function main() {
  let created = 0
  let updated = 0
  for (const row of ROWS) {
    const existing = await prisma.vehicleCategory.findUnique({
      where: { slug: row.slug },
      select: { id: true },
    })
    await prisma.vehicleCategory.upsert({
      where: { slug: row.slug },
      create: {
        name: row.name,
        slug: row.slug,
        sortOrder: row.sortOrder,
        subtitle: row.subtitle ?? null,
        active: true,
        // dailyRate + photoUrl deliberately omitted — null defaults.
      },
      update: {
        name: row.name,
        sortOrder: row.sortOrder,
        // Only write subtitle when the seed row carries one; null-
        // subtitle rows skip the field so an admin-added subtitle
        // isn't wiped on re-seed.
        ...(row.subtitle !== undefined && { subtitle: row.subtitle }),
        // dailyRate, photoUrl, active intentionally NOT in update —
        // admin edits to those survive re-seeding.
      },
    })
    if (existing) updated++
    else created++
  }
  console.log(`vehicle_categories seed: created=${created}, updated=${updated}, total=${ROWS.length}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
