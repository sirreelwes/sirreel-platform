/**
 * Create sr_bug_reports (+ its four enums) with ADDITIVE SQL, not
 * `prisma db push`.
 *
 * 029d94e (2026-09-10) found the live DB carries a table and columns that
 * exist in no schema file; a db push from a checkout would drop them. So a
 * new table arrives like this: CREATE TYPE / CREATE TABLE IF NOT EXISTS,
 * nothing else touched. Safe to re-run.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-bug-reports-table.ts
 *
 * Backs the "Did you find a bug in the system?" box at the top of HQ Help
 * (/guides) and the to-do board at /admin/improvements. Until this has run, the
 * box refuses with a plain message naming this script rather than throwing
 * a raw P2021 at whoever was trying to be helpful.
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `DO $$ BEGIN
     CREATE TYPE "BugSeverity" AS ENUM ('UNTRIAGED','BLOCKER','HIGH','MEDIUM','LOW');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
     CREATE TYPE "BugKind" AS ENUM ('UNTRIAGED','MECHANICAL','DESIGN','HOW_TO','FEATURE_REQUEST','OTHER');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
     CREATE TYPE "BugRouting" AS ENUM ('PENDING','ANSWERED','QUEUED','ESCALATED');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
     CREATE TYPE "BugStatus" AS ENUM ('OPEN','IN_PROGRESS','FIXED','WONT_FIX','DUPLICATE','ANSWERED');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `CREATE TABLE IF NOT EXISTS "sr_bug_reports" (
     "id"                TEXT NOT NULL,
     "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "body"              TEXT NOT NULL,
     "reported_by_id"    TEXT,
     "reported_by_email" TEXT NOT NULL,
     "reported_by_name"  TEXT NOT NULL,
     "reported_by_role"  TEXT,
     "page_path"         TEXT,
     "user_agent"        TEXT,
     "severity"          "BugSeverity" NOT NULL DEFAULT 'UNTRIAGED',
     "kind"              "BugKind" NOT NULL DEFAULT 'UNTRIAGED',
     "routing"           "BugRouting" NOT NULL DEFAULT 'PENDING',
     "status"            "BugStatus" NOT NULL DEFAULT 'OPEN',
     "title"             TEXT,
     "area"              TEXT,
     "reasoning"         TEXT,
     "response"          TEXT,
     "suspects"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
     "triaged_at"        TIMESTAMP(3),
     "triage_model"      TEXT,
     "triage_error"      TEXT,
     "duplicate_of_id"   TEXT,
     "escalated_at"      TIMESTAMP(3),
     "resolved_at"       TIMESTAMP(3),
     "resolved_by_email" TEXT,
     "resolution_note"   TEXT,
     CONSTRAINT "sr_bug_reports_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "sr_bug_reports_status_severity_idx" ON "sr_bug_reports" ("status", "severity")`,
  `CREATE INDEX IF NOT EXISTS "sr_bug_reports_created_at_idx" ON "sr_bug_reports" ("created_at")`,
  `CREATE INDEX IF NOT EXISTS "sr_bug_reports_duplicate_of_id_idx" ON "sr_bug_reports" ("duplicate_of_id")`,
  // Self-reference for duplicate grouping. SET NULL so deleting a parent
  // report un-groups its children rather than deleting other people's
  // reports along with it.
  `DO $$ BEGIN
     ALTER TABLE "sr_bug_reports"
       ADD CONSTRAINT "sr_bug_reports_duplicate_of_id_fkey"
       FOREIGN KEY ("duplicate_of_id") REFERENCES "sr_bug_reports"("id")
       ON DELETE SET NULL ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql.split('\n')[0].trim().slice(0, 78)}`)
  }
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sr_bug_reports' ORDER BY ordinal_position`,
  )
  console.log(`\nsr_bug_reports has ${cols.length} columns:`)
  console.log('  ' + cols.map((c) => c.column_name).join(', '))
  // Prove it end to end the way project_unrun_additive_column_scripts asks:
  // a default-select read is what 500s when a schema column is missing.
  const n = await prisma.bugReport.count()
  console.log(`\ndefault-select read OK — ${n} report(s) on file.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
