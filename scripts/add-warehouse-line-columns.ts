/**
 * Adds the three columns the warehouse-added-line feature reads.
 *
 *   npx tsx scripts/add-warehouse-line-columns.ts            # dry run
 *   npx tsx scripts/add-warehouse-line-columns.ts --write
 *
 * RUN THIS BEFORE THE CODE DEPLOYS. It is not a "fails soft" situation:
 * any Prisma query on OrderLineItem without an explicit `select` selects
 * every column in the schema, so a missing column throws P2022 on the
 * order page, the quote, the invoice and the pull sheet alike. That is
 * exactly how the partner-stage columns broke /api/vendors on 2026-09-11.
 *
 * Additive only. Three NULLABLE columns on sr_order_line_items — no
 * default, no NOT NULL, so there is no table rewrite and no backfill,
 * and every existing row simply reads null (= not warehouse-added, not
 * awaiting a price), which is the correct history.
 *
 * `prisma db push` is NOT usable here and must not be substituted: this
 * checkout's schema is BEHIND the live database, so a push would DROP
 * sr_job_locations and nine sub_rentals columns that exist in no schema
 * file. Read CLAUDE.md's schema section before reaching for it.
 */
import { prisma } from '../src/lib/prisma'

const COLS = [
  ['warehouse_added_at', 'TIMESTAMP(3)'],
  ['warehouse_added_by', 'TEXT'],
  ['pricing_pending_at', 'TIMESTAMP(3)'],
] as const

async function main() {
  const before = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'sr_order_line_items'
      AND column_name IN ('warehouse_added_at','warehouse_added_by','pricing_pending_at')`
  console.log('before:', before.map((r) => r.column_name))

  if (process.argv.includes('--write')) {
    for (const [name, type] of COLS) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE sr_order_line_items ADD COLUMN IF NOT EXISTS ${name} ${type}`,
      )
      console.log(`  + ${name} ${type}`)
    }
  } else {
    console.log('(dry run — pass --write)')
  }

  const after = await prisma.$queryRaw<{ column_name: string; is_nullable: string; data_type: string }[]>`
    SELECT column_name, is_nullable, data_type FROM information_schema.columns
    WHERE table_name = 'sr_order_line_items'
      AND column_name IN ('warehouse_added_at','warehouse_added_by','pricing_pending_at')
    ORDER BY column_name`
  console.log('after:', after)
  await prisma.$disconnect()
}
main()
