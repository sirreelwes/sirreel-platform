/**
 * Add the partner STAGE columns to vendors — with ADDITIVE SQL, not
 * `prisma db push`.
 *
 * 029d94e (2026-09-10) found the live DB carries a table and columns that
 * exist in no schema file; a db push from a checkout would drop them. So a
 * new column is added like this: idempotent ALTER … ADD COLUMN IF NOT EXISTS,
 * nothing else touched. Safe to re-run.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-partner-prospect-columns.ts
 *
 * The columns (Wes 2026-09-11: "no company gets onboarded until they reply
 * and I mark it as a new partner"):
 *   partner_prospect_at   queued so the introduction can be sent
 *   partner_marked_at     Wes's mark, after they reply
 *   partner_marked_by     who pressed it
 *
 * Until this has run, the code fails soft: no prospects are listed, the
 * account link stays gated on the introduction alone (as before), and
 * "Mark as new partner" refuses, naming this script. Existing partners need
 * no backfill — a vendor with roster units, bookings or an agreement reads
 * as a partner already (partnerStage.ts).
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "partner_prospect_at" TIMESTAMP(3)`,
  `ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "partner_marked_at" TIMESTAMP(3)`,
  `ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "partner_marked_by" TEXT`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql}`)
  }
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'vendors' AND column_name LIKE 'partner_%' ORDER BY ordinal_position`,
  )
  console.log('partner columns now:', cols.map((c) => c.column_name).join(', '))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
