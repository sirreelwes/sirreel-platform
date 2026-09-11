/**
 * Add the partner-photo review columns to sub_contracted_vehicle_photos —
 * with ADDITIVE SQL, not `prisma db push`.
 *
 * 029d94e (2026-09-10) found the live DB carries a table and columns that
 * exist in no schema file; a db push from a checkout would drop them. So a
 * new column is added like this: idempotent ALTER … ADD COLUMN IF NOT EXISTS,
 * nothing else touched. Safe to re-run.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-partner-photo-columns.ts
 *
 * Until this has run, the code fails soft: partner uploads still land (the
 * stamp is a separate, guarded write), the action item is empty, and the
 * staff photo card falls back to the pre-review fields.
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `ALTER TABLE "sub_contracted_vehicle_photos" ADD COLUMN IF NOT EXISTS "uploaded_by_partner_at" TIMESTAMP(3)`,
  `ALTER TABLE "sub_contracted_vehicle_photos" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3)`,
  `ALTER TABLE "sub_contracted_vehicle_photos" ADD COLUMN IF NOT EXISTS "reviewed_by_id" TEXT`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql}`)
  }
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'sub_contracted_vehicle_photos' ORDER BY ordinal_position`,
  )
  console.log('columns now:', cols.map((c) => c.column_name).join(', '))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
