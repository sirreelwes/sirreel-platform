/**
 * Columns for the check-IN report Albert sends (Wes, 2026-09-18) — with
 * ADDITIVE SQL, not `prisma db push` (the live DB carries objects no
 * schema file knows; a push offers to drop them).
 *
 *   sr_order_check_report_lines.damaged_qty    INT   came back broken
 *   sr_order_check_reports.report_sent_at      TIMESTAMP
 *   sr_order_check_reports.report_sent_by_id   TEXT
 *   sr_order_check_reports.report_sent_to      TEXT[]
 *
 * Idempotent ADD COLUMN IF NOT EXISTS, nothing else touched. Safe to re-run.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-check-in-report-columns.ts
 *
 * Run this BEFORE the code that reads the columns is deployed: every
 * check-report query names its columns explicitly, so a Prisma select for
 * a column the DB does not have is a P2022 on the report screen, not a
 * silent null.
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `ALTER TABLE "sr_order_check_report_lines" ADD COLUMN IF NOT EXISTS "damaged_qty" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "sr_order_check_reports" ADD COLUMN IF NOT EXISTS "report_sent_at" TIMESTAMP(3)`,
  `ALTER TABLE "sr_order_check_reports" ADD COLUMN IF NOT EXISTS "report_sent_by_id" TEXT`,
  `ALTER TABLE "sr_order_check_reports" ADD COLUMN IF NOT EXISTS "report_sent_to" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql}`)
  }
  for (const table of ['sr_order_check_report_lines', 'sr_order_check_reports']) {
    const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = $1
          AND column_name IN ('damaged_qty','report_sent_at','report_sent_by_id','report_sent_to')
        ORDER BY column_name`,
      table,
    )
    console.log(`${table}:`, cols.map((c) => c.column_name).join(', ') || '(none)')
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
