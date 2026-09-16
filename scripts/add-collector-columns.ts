/**
 * SubRental.collector_name / _set_at / _notified_at — ADDITIVE SQL, not
 * `prisma db push` (the live DB carries objects in no schema file).
 *
 * Wes 2026-09-15: close the "who's collecting" gap — the partner is told who
 * is picking their unit up. Run BEFORE the deploy that selects the columns.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-collector-columns.ts
 *
 * Idempotent.
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `ALTER TABLE sub_rentals ADD COLUMN IF NOT EXISTS collector_name text`,
  `ALTER TABLE sub_rentals ADD COLUMN IF NOT EXISTS collector_set_at timestamp(3)`,
  `ALTER TABLE sub_rentals ADD COLUMN IF NOT EXISTS collector_notified_at timestamp(3)`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql}`)
  }
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'sub_rentals' AND column_name LIKE 'collector%' ORDER BY column_name`,
  )
  console.log('present:', cols.map((c) => c.column_name).join(', ') || 'NONE')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
