/**
 * Client-side improvements + the star rating, by ADDITIVE SQL — never
 * `prisma db push` (project_live_db_drift_no_schema). Safe to re-run.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-client-improvements.ts
 *
 *   ImprovementSource enum (STAFF | CLIENT)
 *   sr_bug_reports.source / company_id / job_id
 *   sr_platform_ratings
 *
 * Must run BEFORE the code deploys: a default-select Prisma read throws
 * P2022 on a column the DB lacks, which would take every improvement read
 * down with it (project_unrun_additive_column_scripts).
 *
 * The new enum is a brand-new TYPE on a brand-new column, so the
 * deploy-first rule for enum VALUES (project_enum_add_before_deploy) does
 * not bite here — no already-running client reads this column at all.
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `DO $$ BEGIN
     CREATE TYPE "ImprovementSource" AS ENUM ('STAFF','CLIENT');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `ALTER TABLE "sr_bug_reports" ADD COLUMN IF NOT EXISTS "source" "ImprovementSource" NOT NULL DEFAULT 'STAFF'`,
  `ALTER TABLE "sr_bug_reports" ADD COLUMN IF NOT EXISTS "company_id" TEXT`,
  `ALTER TABLE "sr_bug_reports" ADD COLUMN IF NOT EXISTS "job_id" TEXT`,
  `CREATE INDEX IF NOT EXISTS "sr_bug_reports_source_idx" ON "sr_bug_reports" ("source", "status")`,
  `CREATE TABLE IF NOT EXISTS "sr_platform_ratings" (
     "id"           TEXT NOT NULL,
     "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "stars"        INTEGER NOT NULL,
     "comment"      TEXT,
     "source"       "ImprovementSource" NOT NULL DEFAULT 'CLIENT',
     "person_email" TEXT NOT NULL,
     "person_name"  TEXT NOT NULL,
     "company_id"   TEXT,
     "job_id"       TEXT,
     CONSTRAINT "sr_platform_ratings_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "sr_platform_ratings_person_job_key"
     ON "sr_platform_ratings" ("person_email", "job_id")`,
  `CREATE INDEX IF NOT EXISTS "sr_platform_ratings_created_idx" ON "sr_platform_ratings" ("created_at")`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql.split('\n')[0].trim().slice(0, 76)}`)
  }
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sr_bug_reports' AND column_name IN ('source','company_id','job_id')
      ORDER BY column_name`,
  )
  console.log(`\nsr_bug_reports gained: ${cols.map((c) => c.column_name).join(', ') || 'NONE'}`)
  console.log(`improvements readable: ${await prisma.bugReport.count()}`)
  console.log(`ratings readable: ${await prisma.platformRating.count()}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
