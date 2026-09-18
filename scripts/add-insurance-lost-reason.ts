/**
 * Add INSURANCE to the LostReason enum — with ADDITIVE SQL, not
 * `prisma db push` (the live DB carries objects no schema file knows; a push
 * would offer to drop them).
 *
 * Wes 2026-09-18: "We've lost a couple of jobs because of improper insurance
 * from the Production. I'd like to have this as an option." It is its own
 * reason, not a flavour of SCOPE_CHANGED — the show is still happening.
 *
 * Order matters (a Prisma client 500s reading an enum value Postgres does not
 * have, and the picker offers the value the moment the code deploys):
 *   1. run this — the value exists, no row uses it
 *   2. deploy the code that knows it
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-insurance-lost-reason.ts
 *
 * Idempotent. ALTER TYPE … ADD VALUE cannot run inside a transaction, so the
 * statement goes on its own.
 */
import { prisma } from '../src/lib/prisma'

const STATEMENT = `ALTER TYPE "LostReason" ADD VALUE IF NOT EXISTS 'INSURANCE'`

async function main() {
  await prisma.$executeRawUnsafe(STATEMENT)
  console.log(`✓ ${STATEMENT}`)
  const rows = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
    `SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
     WHERE t.typname = 'LostReason' ORDER BY e.enumsortorder`,
  )
  console.log(`LostReason: ${rows.map((r) => r.enumlabel).join(', ')}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
