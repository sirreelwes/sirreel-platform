/**
 * Add PHOTO_SHOOT to the LineItemDepartment and PartnerCatalogSection enums —
 * with ADDITIVE SQL, not `prisma db push` (the live DB carries objects in no
 * schema file; a push would drop them).
 *
 * Wes 2026-09-11: "for VSM planet, photo shoot rentals is going to be a new
 * class of rentals" — a quote department and a public catalog section.
 *
 * Order matters (a Prisma client 500s reading an enum value it does not know):
 *   1. run this — the values exist, no row uses them
 *   2. deploy the code that knows them
 *   3. only then write rows with them (move VSM Planet into the section)
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-photo-shoot-enum-values.ts
 *
 * Idempotent. ALTER TYPE … ADD VALUE cannot run inside a transaction, so each
 * statement goes on its own.
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `ALTER TYPE "LineItemDepartment" ADD VALUE IF NOT EXISTS 'PHOTO_SHOOT'`,
  `ALTER TYPE "PartnerCatalogSection" ADD VALUE IF NOT EXISTS 'PHOTO_SHOOT'`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql}`)
  }
  const rows = await prisma.$queryRawUnsafe<{ typname: string; enumlabel: string }[]>(
    `SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname IN ('LineItemDepartment','PartnerCatalogSection') ORDER BY t.typname, e.enumsortorder`,
  )
  const by: Record<string, string[]> = {}
  for (const r of rows) (by[r.typname] ??= []).push(r.enumlabel)
  for (const [k, v] of Object.entries(by)) console.log(`${k}: ${v.join(', ')}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
