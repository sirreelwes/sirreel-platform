/**
 * The broker directory's two tables, as additive SQL.
 *
 * Wes 2026-09-17: "Please start keeping a list of brokers." Until now a
 * broker existed only inside whichever certificate happened to name them —
 * `aiResponse.producer`, read on demand (src/lib/coi/broker.ts). That is the
 * right place for a FACT off one document and the wrong place for a LIST:
 * nothing could answer "who is Mega's broker" without opening their last COI
 * and hoping the producer box read.
 *
 *   sr_brokers         — one row per broker, keyed by EMAIL. The agency, the
 *                        person, the phone, and when we last saw or wrote to
 *                        them.
 *   sr_broker_clients  — which of our clients each broker acts for, and how
 *                        we learned it. A broker serves many productions and
 *                        a production changes brokers, so this is a join
 *                        table, not a column on either side.
 *
 * Plain data — the maintenance registry carries it and the page imports the
 * registry, so no Prisma here. Every statement is CREATE … IF NOT EXISTS, so
 * either door can be used twice.
 *
 * Run from /admin/maintenance ("Create the broker directory tables") or
 * `npx tsx scripts/add-broker-tables.ts`.
 *
 * No FOREIGN KEY to companies or users on purpose: these are brand-new
 * tables against a live DB with known drift, and the Prisma models carry no
 * relation either (the Company and User models are untouched — the same
 * shape the job-Conversation tables ship in). A company deleted out from
 * under a link leaves a dead row the reader skips, which is cheaper than a
 * constraint that can fail a COI review.
 */
import type { AdditiveDdl } from '@/lib/admin/additiveDdl'

export const BROKER_TABLES_DDL: AdditiveDdl = {
  tables: ['sr_brokers', 'sr_broker_clients'],
  statements: [
    `CREATE TABLE IF NOT EXISTS "sr_brokers" (
       "id" TEXT NOT NULL,
       "email" TEXT NOT NULL,
       "name" TEXT,
       "agency" TEXT,
       "phone" TEXT,
       "address" TEXT,
       "notes" TEXT,
       "is_active" BOOLEAN NOT NULL DEFAULT true,
       "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "last_seen_at" TIMESTAMP(3),
       "last_contacted_at" TIMESTAMP(3),
       "times_contacted" INTEGER NOT NULL DEFAULT 0,
       "created_by_user_id" TEXT,
       "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT "sr_brokers_pkey" PRIMARY KEY ("id")
     )`,
    // The email IS the identity — one row per broker, so a second
    // certificate from the same agent updates rather than duplicates.
    `CREATE UNIQUE INDEX IF NOT EXISTS "sr_brokers_email_key" ON "sr_brokers" ("email")`,
    `CREATE INDEX IF NOT EXISTS "sr_brokers_agency_idx" ON "sr_brokers" ("agency")`,
    `CREATE TABLE IF NOT EXISTS "sr_broker_clients" (
       "id" TEXT NOT NULL,
       "broker_id" TEXT NOT NULL,
       "company_id" TEXT NOT NULL,
       "insured_name" TEXT,
       "source" TEXT NOT NULL,
       "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT "sr_broker_clients_pkey" PRIMARY KEY ("id")
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "sr_broker_clients_broker_id_company_id_key" ON "sr_broker_clients" ("broker_id", "company_id")`,
    `CREATE INDEX IF NOT EXISTS "sr_broker_clients_company_id_idx" ON "sr_broker_clients" ("company_id")`,
  ],
}
