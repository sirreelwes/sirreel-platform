/**
 * Add the human-review columns to sr_bug_reports with ADDITIVE SQL, never
 * `prisma db push` (project_live_db_drift_no_schema). Safe to re-run.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-improvement-review-columns.ts
 *
 * reviewed_at / reviewed_by_email record that a PERSON agreed with what the
 * triage agent decided. Wes 2026-09-19: the agent answering something must
 * not make it vanish — if somebody took the trouble to type, that friction
 * was real whether or not the mechanics were broken.
 *
 * Run BEFORE the code deploys: a default-select Prisma read throws P2022 on
 * a missing column and would take every improvement read down with it.
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `ALTER TABLE "sr_bug_reports" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3)`,
  `ALTER TABLE "sr_bug_reports" ADD COLUMN IF NOT EXISTS "reviewed_by_email" TEXT`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql}`)
  }
  // Anything the agent already closed on its own is, by this rule,
  // unreviewed — leave reviewed_at null so it resurfaces for a glance.
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sr_bug_reports' AND column_name LIKE 'reviewed%' ORDER BY column_name`,
  )
  console.log(`\npresent: ${cols.map((c) => c.column_name).join(', ') || 'NONE'}`)
  console.log(`default-select read OK — ${await prisma.bugReport.count()} on file.`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
