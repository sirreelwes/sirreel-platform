/**
 * The INSURANCE value on the `LostReason` enum, as additive SQL. Plain data
 * — the maintenance registry carries it and the page imports the registry,
 * so no Prisma here.
 *
 * Wes 2026-09-18: "We've lost a couple of jobs because of improper
 * insurance from the Production. I'd like to have this as an option." The
 * picker offers the option the moment the code deploys, so Postgres has to
 * know the label or the rep's submit fails.
 *
 * Run from /admin/maintenance ("Add the insurance lost reason") or
 * `npx tsx scripts/add-insurance-lost-reason.ts` — one statement, two
 * doors. `ADD VALUE IF NOT EXISTS` is idempotent, so either can be used
 * twice.
 */
import type { AdditiveDdl } from '@/lib/admin/additiveDdl'

export const INSURANCE_LOST_REASON_DDL: AdditiveDdl = {
  tables: [],
  enums: [{ type: 'LostReason', values: ['INSURANCE'] }],
  statements: [`ALTER TYPE "LostReason" ADD VALUE IF NOT EXISTS 'INSURANCE'`],
}
