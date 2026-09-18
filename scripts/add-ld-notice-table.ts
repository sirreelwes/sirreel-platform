/**
 * Add sr_ld_notices — what the production was told did not come back.
 *
 * ADDITIVE SQL, not `prisma db push`. As of 2026-09-18 a `migrate diff`
 * from this schema still proposes DROP COLUMN against
 * sr_order_check_reports / sr_order_check_report_lines and DROP TABLE
 * playing_with_neon — live-DB objects that exist in no schema file (another
 * session's in-flight work). A push from here would take them with it.
 * See memory: project_live_db_drift_no_schema.
 *
 * Re-runnable: every statement is IF NOT EXISTS. Run it once per
 * environment BEFORE the code that reads LdNotice is live — a Prisma query
 * against a missing table throws, and `composeLdNotice` only guards its
 * `lastNotice` read.
 *
 *   npx tsx scripts/add-ld-notice-table.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "sr_ld_notices" (
      "id"              TEXT NOT NULL,
      "order_id"        TEXT NOT NULL,
      "lines"           JSONB NOT NULL,
      "subtotal"        DECIMAL(12,2) NOT NULL DEFAULT 0,
      "note"            TEXT,
      "sent_at"         TIMESTAMP(3),
      "sent_to_address" TEXT,
      "sent_cc"         TEXT[] DEFAULT ARRAY[]::TEXT[],
      "sent_by_id"      TEXT,
      "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      -- No DEFAULT: @updatedAt is written by Prisma on every write, and a
      -- DB default here shows up forever as drift in \`migrate diff\`.
      "updated_at"      TIMESTAMP(3) NOT NULL,
      CONSTRAINT "sr_ld_notices_pkey" PRIMARY KEY ("id")
    )
  `)

  // A table created by an earlier run of this script carried the default.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "sr_ld_notices" ALTER COLUMN "updated_at" DROP DEFAULT`,
  )

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "sr_ld_notices_order_id_created_at_idx"
      ON "sr_ld_notices" ("order_id", "created_at" DESC)
  `)

  // Named to match what Prisma would have generated, so a future
  // `migrate diff` sees the constraint it expects and proposes nothing.
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sr_ld_notices_order_id_fkey'
      ) THEN
        ALTER TABLE "sr_ld_notices"
          ADD CONSTRAINT "sr_ld_notices_order_id_fkey"
          FOREIGN KEY ("order_id") REFERENCES "sr_orders"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$;
  `)

  const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'sr_ld_notices' ORDER BY ordinal_position`,
  )
  console.log(`sr_ld_notices: ${cols.length} columns —`, cols.map((c) => c.column_name).join(', '))

  // Prove it is actually queryable, not just present. A default-select read
  // is the check that catches a column the schema has and the DB does not
  // (see memory: project_unrun_additive_column_scripts).
  const n = await prisma.ldNotice.count()
  console.log(`prisma.ldNotice.count() = ${n} — the model reads.`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
