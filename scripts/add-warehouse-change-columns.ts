/**
 * Add the "warehouse changed this line at pickup" columns — with ADDITIVE
 * SQL, not `prisma db push` (the live DB carries objects no schema file
 * knows; a push offers to drop them).
 *
 *   sr_order_line_items.warehouse_change        TEXT       'ADDED' | 'SWAPPED'
 *   sr_order_line_items.warehouse_change_at     TIMESTAMP  when the sheet was filed
 *   sr_order_line_items.warehouse_change_by_id  TEXT       the supervisor (soft FK to users)
 *   sr_order_line_items.warehouse_change_from   TEXT       what a swap replaced
 *
 * Idempotent ADD COLUMN IF NOT EXISTS, nothing else touched. Safe to re-run.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-warehouse-change-columns.ts
 *
 * Run this BEFORE the code that reads the columns is deployed. Unlike the
 * scan table there is no fail-soft here: Prisma selects every scalar on
 * OrderLineItem, so with the columns missing EVERY order read 500s. The
 * columns are nullable and unknown to the old code, so running the script
 * first is harmless.
 */
import { prisma } from '../src/lib/prisma'

const TABLE = 'sr_order_line_items'
const COLUMNS = ['warehouse_change', 'warehouse_change_at', 'warehouse_change_by_id', 'warehouse_change_from']

const STATEMENTS = [
  `ALTER TABLE "${TABLE}" ADD COLUMN IF NOT EXISTS "warehouse_change" TEXT`,
  `ALTER TABLE "${TABLE}" ADD COLUMN IF NOT EXISTS "warehouse_change_at" TIMESTAMP(3)`,
  `ALTER TABLE "${TABLE}" ADD COLUMN IF NOT EXISTS "warehouse_change_by_id" TEXT`,
  `ALTER TABLE "${TABLE}" ADD COLUMN IF NOT EXISTS "warehouse_change_from" TEXT`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql}`)
  }
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = ANY($2::text[]) ORDER BY column_name`,
    TABLE,
    COLUMNS,
  )
  const present = cols.map((c) => c.column_name)
  console.log(`${TABLE}:`, present.join(', ') || '(none)')
  const missing = COLUMNS.filter((c) => !present.includes(c))
  if (missing.length) {
    console.error(`still missing: ${missing.join(', ')}`)
    process.exit(2)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
