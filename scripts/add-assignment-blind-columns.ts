/**
 * Add the per-vehicle blind-handoff columns to booking_assignments — with
 * ADDITIVE SQL, not `prisma db push` (the live DB carries objects no schema
 * file knows about; a push from a checkout would drop them).
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-assignment-blind-columns.ts
 *
 * Jose 2026-09-16: a job with several vehicles needs only SOME of them
 * blind. Both columns are nullable — NULL means "follow the order", which
 * is every existing row, so nothing changes until someone flips a vehicle.
 *
 * Run BEFORE the code that reads BookingAssignment.blindPickup deploys:
 * any Prisma read of the model without an explicit select lists every
 * schema column and 500s on a missing one. Idempotent; safe to re-run.
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `ALTER TABLE "booking_assignments" ADD COLUMN IF NOT EXISTS "blind_pickup" BOOLEAN`,
  `ALTER TABLE "booking_assignments" ADD COLUMN IF NOT EXISTS "blind_return" BOOLEAN`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql}`)
  }
  const cols = await prisma.$queryRawUnsafe<{ column_name: string; is_nullable: string }[]>(
    `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'booking_assignments' AND column_name LIKE 'blind_%' ORDER BY ordinal_position`,
  )
  console.log('blind columns now:', cols.map((c) => `${c.column_name} (nullable ${c.is_nullable})`).join(', '))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
