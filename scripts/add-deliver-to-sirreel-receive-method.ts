/**
 * DELIVER_TO_SIRREEL on ReceiveMethod — ADDITIVE SQL, not `prisma db push`
 * (the live DB carries objects in no schema file).
 *
 * Wes 2026-09-16: "we need to have the option Deliver to SirReel - Sun
 * Valley", and then: "if they are delivered, they should be on the Pick
 * List but in a different section (Partner) … Both subbed and partner
 * equipment have to be returned to their host warehouse."
 *
 * WHY A NEW VALUE RATHER THAN REUSING DELIVERY. On an ad-hoc sub-lease
 * DELIVERY already means "vendor drops at SirReel's location" — the enum's
 * original meaning. On a PARTNER unit the word was re-pointed (2026-09-10)
 * to mean the partner delivers to SET. One value, two destinations,
 * depending on whether the row happens to carry a roster unit. Adding a
 * fourth value is the only way to say "to our yard" about a partner unit
 * without re-reading every existing DELIVERY row and guessing which sense
 * was meant.
 *
 * Order matters (a Prisma client 500s on an enum value it does not know):
 *   1. run this — the value exists, no row uses it
 *   2. deploy the code that knows it
 *   3. only then set a vendor or a booking to DELIVER_TO_SIRREEL
 *
 * FROM A LAPTOP:
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-deliver-to-sirreel-receive-method.ts
 *
 * FROM ANYWHERE ELSE (Neon console → SQL editor), this one statement:
 *   ALTER TYPE "ReceiveMethod" ADD VALUE IF NOT EXISTS 'DELIVER_TO_SIRREEL';
 *
 * Idempotent. ALTER TYPE … ADD VALUE cannot run inside a transaction, which
 * is also why this is not a /admin/maintenance task.
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `ALTER TYPE "ReceiveMethod" ADD VALUE IF NOT EXISTS 'DELIVER_TO_SIRREEL'`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql}`)
  }
  const e = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
    `SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname = 'ReceiveMethod' ORDER BY e.enumsortorder`,
  )
  console.log(`ReceiveMethod: ${e.map((r) => r.enumlabel).join(', ')}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
