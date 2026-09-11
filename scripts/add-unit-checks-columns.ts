/**
 * Add the per-unit accessory check columns — with ADDITIVE SQL, not
 * `prisma db push` (the live DB carries objects no schema file knows; a
 * push offers to drop them).
 *
 *   inventory_items.unit_checks      TEXT[]  "Antenna", "Battery" on a CP200
 *   sr_order_unit_scans.missing_out  TEXT[]  what was not with the unit going out
 *   sr_order_unit_scans.missing_in   TEXT[]  what was not with it coming back
 *
 * Idempotent ADD COLUMN IF NOT EXISTS, nothing else touched. Safe to re-run.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-unit-checks-columns.ts
 *
 * Run this BEFORE the code that reads the columns is deployed: the scan
 * summary treats a missing column like a missing table and hides the
 * scanner panel until the columns exist.
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "unit_checks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`,
  `ALTER TABLE "sr_order_unit_scans" ADD COLUMN IF NOT EXISTS "missing_out" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`,
  `ALTER TABLE "sr_order_unit_scans" ADD COLUMN IF NOT EXISTS "missing_in" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql}`)
  }
  for (const table of ['inventory_items', 'sr_order_unit_scans']) {
    const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name IN ('unit_checks','missing_out','missing_in') ORDER BY column_name`,
      table,
    )
    console.log(`${table}:`, cols.map((c) => c.column_name).join(', ') || '(none)')
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
