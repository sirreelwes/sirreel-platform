/**
 * Add the context envelope + follow-up columns to sr_bug_reports, with
 * ADDITIVE SQL rather than `prisma db push` (the live DB carries objects
 * no schema file has — see project_live_db_drift_no_schema). Safe to re-run.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-bug-context-columns.ts
 *
 *   context             jsonb  what the browser saw (BugContext)
 *   follow_up_question  text   the one question the agent asked back
 *   follow_up_answer    text   what the reporter answered
 *
 * MUST be run before the code that reads them deploys: a Prisma query with
 * no explicit `select` selects EVERY schema column, so a missing column
 * makes every bugReport read throw P2022 — the exact failure that took the
 * partner columns down on 2026-09-11.
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `ALTER TABLE "sr_bug_reports" ADD COLUMN IF NOT EXISTS "context" JSONB`,
  `ALTER TABLE "sr_bug_reports" ADD COLUMN IF NOT EXISTS "follow_up_question" TEXT`,
  `ALTER TABLE "sr_bug_reports" ADD COLUMN IF NOT EXISTS "follow_up_answer" TEXT`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql}`)
  }
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sr_bug_reports'
        AND column_name IN ('context','follow_up_question','follow_up_answer')
      ORDER BY column_name`,
  )
  console.log(`\npresent: ${cols.map((c) => c.column_name).join(', ') || 'NONE'}`)
  // The proof that matters: a default-select read, which is what 500s.
  const n = await prisma.bugReport.count()
  console.log(`default-select read OK — ${n} report(s) on file.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
