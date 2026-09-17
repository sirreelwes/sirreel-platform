/**
 * The two job-Conversation tables (Phase 2 of one-thread-per-job), as
 * additive SQL. Plain data — the maintenance registry carries it and the
 * page imports the registry, so no Prisma here.
 *
 *   sr_job_threads      — one row per job: who is answering / which desk it
 *                         was handed to. Created lazily on the first claim.
 *   sr_job_thread_notes — internal notes interleaved in the job's
 *                         conversation. Never sent anywhere.
 *
 * Run from /admin/maintenance ("Create the job Conversation tables") or
 * `npx tsx scripts/add-job-thread-tables.ts` — one statement list, two
 * doors. Every statement is IF NOT EXISTS, so either door can be used twice.
 */
import type { AdditiveDdl } from '@/lib/admin/additiveDdl'

export const JOB_THREAD_TABLES_DDL: AdditiveDdl = {
  tables: ['sr_job_threads', 'sr_job_thread_notes'],
  statements: [
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
  ],
}
