/**
 * Add CARS_SUVS to the PartnerCatalogSection enum — with ADDITIVE SQL, not
 * `prisma db push` (the live DB carries objects in no schema file; a push
 * would drop them).
 *
 * Wes 2026-09-15: a "Cars & SUVs" catalog section, for California Rent A Car.
 *
 * Order matters (a Prisma client 500s reading an enum value it does not know):
 *   1. run this — the value exists, no row uses it
 *   2. deploy the code that knows it
 *   3. only then write rows with it (move California Rent A Car into it)
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-cars-suvs-section.ts
 *
 * Idempotent. ALTER TYPE … ADD VALUE cannot run inside a transaction.
 */
import { prisma } from '../src/lib/prisma'

const SQL = `ALTER TYPE "PartnerCatalogSection" ADD VALUE IF NOT EXISTS 'CARS_SUVS' AFTER 'LOCATION_VEHICLES'`

async function main() {
  await prisma.$executeRawUnsafe(SQL)
  console.log(`✓ ${SQL}`)
  const rows = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
    `SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname = 'PartnerCatalogSection' ORDER BY e.enumsortorder`,
  )
  console.log(`PartnerCatalogSection: ${rows.map((r) => r.enumlabel).join(', ')}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
