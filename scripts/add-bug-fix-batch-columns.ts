/**
 * Add the fix-handoff columns to sr_bug_reports with ADDITIVE SQL, never
 * `prisma db push` (project_live_db_drift_no_schema). Safe to re-run.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-bug-fix-batch-columns.ts
 *
 *   fix_batch_id        text   which hand-off to Claude Code this belongs to
 *   queued_for_fix_at   ts     when Wes handed it over
 *
 * Run BEFORE the code deploys: a default-select Prisma read throws P2022 on
 * a missing column, which would take every bug-report read down with it.
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `ALTER TABLE "sr_bug_reports" ADD COLUMN IF NOT EXISTS "fix_batch_id" TEXT`,
  `ALTER TABLE "sr_bug_reports" ADD COLUMN IF NOT EXISTS "queued_for_fix_at" TIMESTAMP(3)`,
  `CREATE INDEX IF NOT EXISTS "sr_bug_reports_fix_batch_idx" ON "sr_bug_reports" ("fix_batch_id")`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql}`)
  }
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sr_bug_reports'
        AND column_name IN ('fix_batch_id','queued_for_fix_at') ORDER BY column_name`,
  )
  console.log(`\npresent: ${cols.map((c) => c.column_name).join(', ') || 'NONE'}`)
  console.log(`default-select read OK — ${await prisma.bugReport.count()} report(s) on file.`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
