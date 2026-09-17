/**
 * Add the two job-Conversation tables with ADDITIVE SQL, not `prisma db
 * push` (the live DB carries objects in no schema file; a push would drop
 * them).
 *
 * Phase 2 of one-thread-per-job (docs/specs/job-thread-one-conversation.md):
 *   sr_job_threads      — one row per job: who is answering / which desk it
 *                         was handed to. Created lazily on the first claim.
 *   sr_job_thread_notes — internal notes interleaved in the job's
 *                         conversation. Never sent anywhere.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-job-thread-tables.ts
 *
 * Idempotent: every statement is IF NOT EXISTS. Until it has run, the
 * Conversation panel still shows the emails (they live in email_messages)
 * and the notes / claim controls report that this script is needed.
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "sr_job_threads" (
     "id" TEXT NOT NULL,
     "job_id" TEXT NOT NULL,
     "claimed_by_user_id" TEXT,
     "claimed_lane" TEXT,
     "claimed_at" TIMESTAMP(3),
     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "sr_job_threads_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "sr_job_threads_job_id_key" ON "sr_job_threads" ("job_id")`,
  `CREATE TABLE IF NOT EXISTS "sr_job_thread_notes" (
     "id" TEXT NOT NULL,
     "job_id" TEXT NOT NULL,
     "author_user_id" TEXT NOT NULL,
     "body" TEXT NOT NULL,
     "mentions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
     "anchored_email_message_id" TEXT,
     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "sr_job_thread_notes_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "sr_job_thread_notes_job_id_created_at_idx" ON "sr_job_thread_notes" ("job_id", "created_at")`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql.split('\n')[0].trim()}`)
  }
  for (const table of ['sr_job_threads', 'sr_job_thread_notes']) {
    const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = '${table}' ORDER BY ordinal_position`,
    )
    console.log(`${table}:`, cols.map((c) => c.column_name).join(', '))
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
