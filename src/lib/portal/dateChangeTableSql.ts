/**
 * The client date-change request table, as additive SQL.
 *
 * Wes 2026-09-18, on the L'anza job: "client said they wanted to change the
 * pickup date but couldn't figure out how to do that." The portal showed
 * Pickup and Return as two lines of text with no affordance beside them, so
 * the only way to ask was to find the rep's number somewhere else on the
 * page. This table is where the ask lands.
 *
 * ONE table, created by `CREATE TABLE … IF NOT EXISTS` — which is the one
 * class of schema change /admin/maintenance may run, so Wes can put it in
 * the database from a phone (src/lib/admin/additiveDdl.ts). Columns mirror
 * `model OrderDateChangeRequest` in prisma/schema.prisma; the dates are
 * DATE, matching Order.start_date / end_date, because a pickup day has no
 * time-of-day and a timestamp here would drift a day west of UTC.
 *
 * Plain data — the maintenance registry carries it and the page imports the
 * registry, so no Prisma in this file.
 */
import type { AdditiveDdl } from '@/lib/admin/additiveDdl'

export const DATE_CHANGE_REQUEST_TABLE_DDL: AdditiveDdl = {
  tables: ['sr_order_date_change_requests'],
  statements: [
    `CREATE TABLE IF NOT EXISTS "sr_order_date_change_requests" (
       "id" TEXT NOT NULL,
       "order_id" TEXT NOT NULL,
       "job_id" TEXT,
       "requested_by_person_id" TEXT,
       "requested_by_name" TEXT,
       "requested_by_email" TEXT,
       "current_start_date" DATE,
       "current_end_date" DATE,
       "requested_start_date" DATE,
       "requested_end_date" DATE,
       "note" TEXT,
       "source" TEXT NOT NULL DEFAULT 'JOB_PORTAL',
       "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "resolved_at" TIMESTAMP(3),
       "resolved_reason" TEXT,
       "resolved_by_id" TEXT,
       CONSTRAINT "sr_order_date_change_requests_pkey" PRIMARY KEY ("id")
     )`,
    `CREATE INDEX IF NOT EXISTS "sr_order_date_change_requests_order_id_resolved_at_idx" ON "sr_order_date_change_requests" ("order_id", "resolved_at")`,
    `CREATE INDEX IF NOT EXISTS "sr_order_date_change_requests_resolved_at_idx" ON "sr_order_date_change_requests" ("resolved_at")`,
  ],
}
