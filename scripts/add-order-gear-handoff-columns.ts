/**
 * Add the gear-handoff columns to sr_orders — with ADDITIVE SQL, not
 * `prisma db push` (the live DB carries objects no schema file knows;
 * a push would drop them — see scripts/add-partner-photo-columns.ts).
 *
 *   gear_handoff                 'WILL_CALL' | 'LOAD_ON' | NULL
 *   gear_loads_on_assignment_id  BookingAssignment id when LOAD_ON
 *
 * Wes 2026-09-12: the order form's reservation section "asks if will
 * call or loaded onto one of the assets reserved". Idempotent; safe to
 * re-run. RUN BEFORE the code deploys — the order GET is an `include`
 * (default select), which 500s on a column the DB does not have yet.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-order-gear-handoff-columns.ts
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `ALTER TABLE "sr_orders" ADD COLUMN IF NOT EXISTS "gear_handoff" TEXT`,
  `ALTER TABLE "sr_orders" ADD COLUMN IF NOT EXISTS "gear_loads_on_assignment_id" TEXT`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql}`)
  }
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'sr_orders' AND column_name LIKE 'gear_%' ORDER BY ordinal_position`,
  )
  console.log('gear columns now:', cols.map((c) => c.column_name).join(', '))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
