/**
 * WILL_CALL on ReceiveMethod + Vendor.default_receive_method — ADDITIVE SQL,
 * not `prisma db push` (the live DB carries objects in no schema file).
 *
 * Wes 2026-09-15: car-rental partners (California Rent A Car) — the
 * production picks up at the partner's lot; delivery stays possible,
 * arranged by the partner through the portal.
 *
 * Order matters (a Prisma client 500s on an enum value or a selected column
 * it does not know):
 *   1. run this — the value and the column exist, no row uses them
 *   2. deploy the code that knows them
 *   3. only then set California Rent A Car's default to WILL_CALL
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-will-call-receive-method.ts
 *
 * Idempotent. ALTER TYPE … ADD VALUE cannot run inside a transaction.
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `ALTER TYPE "ReceiveMethod" ADD VALUE IF NOT EXISTS 'WILL_CALL'`,
  `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS default_receive_method "ReceiveMethod"`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql}`)
  }
  const e = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(`SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname = 'ReceiveMethod' ORDER BY e.enumsortorder`)
  const c = await prisma.$queryRawUnsafe<{ column_name: string }[]>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'vendors' AND column_name = 'default_receive_method'`)
  console.log(`ReceiveMethod: ${e.map((r) => r.enumlabel).join(', ')} · vendors.default_receive_method: ${c.length ? 'present' : 'MISSING'}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
