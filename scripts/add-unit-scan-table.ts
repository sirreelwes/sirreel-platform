/**
 * Create sr_order_unit_scans (barcode phase 3) — with ADDITIVE SQL, not
 * `prisma db push`.
 *
 * 029d94e (2026-09-10) found the live DB carries a table and columns that
 * exist in no schema file; a db push from any checkout offers to drop
 * them. So the scan table is created like the partner-photo columns:
 * idempotent CREATE … IF NOT EXISTS, foreign keys added only when absent,
 * nothing else touched. Safe to re-run; safe to run against a DB where
 * someone has already created the table (it reports the columns so a
 * mismatch is visible rather than silent).
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-unit-scan-table.ts
 *
 * Until this has run, the check in/out report's scanner panel hides itself
 * (unitScanSummary fails soft on P2021) and the sheet is typed as before.
 *
 * The DDL is what `prisma migrate diff --from-empty` emits for the model,
 * with IF NOT EXISTS guards added. Keep it in lockstep with
 * `model OrderUnitScan` in prisma/schema.prisma.
 */
import { prisma } from '../src/lib/prisma'

const TABLE = 'sr_order_unit_scans'

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "${TABLE}" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_line_item_id" TEXT,
    "inventory_unit_id" TEXT NOT NULL,
    "inventory_item_id" TEXT,
    "barcode" TEXT NOT NULL,
    "out_scanned_at" TIMESTAMP(3),
    "out_scanned_by_id" TEXT,
    "in_scanned_at" TIMESTAMP(3),
    "in_scanned_by_id" TEXT,
    "in_implied" BOOLEAN NOT NULL DEFAULT false,
    "voided_at" TIMESTAMP(3),
    "voided_by_id" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "${TABLE}_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "${TABLE}_order_id_idx" ON "${TABLE}"("order_id")`,
  `CREATE INDEX IF NOT EXISTS "${TABLE}_inventory_unit_id_idx" ON "${TABLE}"("inventory_unit_id")`,
  `CREATE INDEX IF NOT EXISTS "${TABLE}_order_line_item_id_idx" ON "${TABLE}"("order_line_item_id")`,
]

/** Postgres has no ADD CONSTRAINT IF NOT EXISTS; guard each FK by name. */
const FOREIGN_KEYS: Array<{ name: string; sql: string }> = [
  {
    name: `${TABLE}_order_id_fkey`,
    sql: `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${TABLE}_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sr_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  },
  {
    name: `${TABLE}_order_line_item_id_fkey`,
    sql: `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${TABLE}_order_line_item_id_fkey" FOREIGN KEY ("order_line_item_id") REFERENCES "sr_order_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  },
  {
    name: `${TABLE}_inventory_unit_id_fkey`,
    sql: `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${TABLE}_inventory_unit_id_fkey" FOREIGN KEY ("inventory_unit_id") REFERENCES "sr_inventory_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  },
]

const EXPECTED_COLUMNS = [
  'id', 'order_id', 'order_line_item_id', 'inventory_unit_id', 'inventory_item_id', 'barcode',
  'out_scanned_at', 'out_scanned_by_id', 'in_scanned_at', 'in_scanned_by_id', 'in_implied',
  'voided_at', 'voided_by_id', 'void_reason', 'created_at', 'updated_at',
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql.split('\n')[0].trim()}`)
  }

  for (const fk of FOREIGN_KEYS) {
    const present = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM pg_constraint WHERE conname = $1`,
      fk.name,
    )
    if (present[0]?.n) {
      console.log(`· ${fk.name} already present`)
      continue
    }
    await prisma.$executeRawUnsafe(fk.sql)
    console.log(`✓ ${fk.name}`)
  }

  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
    TABLE,
  )
  const have = cols.map((c) => c.column_name)
  console.log('columns now:', have.join(', '))
  const missing = EXPECTED_COLUMNS.filter((c) => !have.includes(c))
  const extra = have.filter((c) => !EXPECTED_COLUMNS.includes(c))
  if (missing.length || extra.length) {
    console.error(
      `✗ ${TABLE} does not match model OrderUnitScan — missing: [${missing.join(', ')}] extra: [${extra.join(', ')}]. ` +
        'The table pre-existed with a different shape; reconcile by hand before scanning.',
    )
    process.exit(2)
  }
  console.log(`✓ ${TABLE} matches model OrderUnitScan`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
