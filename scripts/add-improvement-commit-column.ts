/**
 * Add resolution_commit to sr_bug_reports with ADDITIVE SQL, never
 * `prisma db push` (project_live_db_drift_no_schema). Safe to re-run.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-improvement-commit-column.ts
 *
 * Holds the commit SHA that closed an improvement out, so "is it fixed?"
 * has an answer you can look at instead of re-testing by hand.
 *
 * Run BEFORE the code deploys — a default-select Prisma read throws P2022
 * on a missing column and would take every improvement read down with it.
 */
import { prisma } from '../src/lib/prisma'

async function main() {
  const sql = `ALTER TABLE "sr_bug_reports" ADD COLUMN IF NOT EXISTS "resolution_commit" TEXT`
  await prisma.$executeRawUnsafe(sql)
  console.log(`✓ ${sql}`)
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sr_bug_reports' AND column_name = 'resolution_commit'`,
  )
  console.log(`present: ${cols.length ? 'yes' : 'NO'}`)
  console.log(`default-select read OK — ${await prisma.bugReport.count()} on file.`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
