/**
 * Additive ALTER for DriverAssignment.smsSentTo (2026-09-15).
 *
 * `prisma db push` is not usable on this database (live drift — it
 * proposes DROPs), so a new column goes on by hand, IF NOT EXISTS, and
 * BEFORE the code that selects it deploys: a default select against a
 * missing column 500s the route.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-driver-assignment-sms-column.ts
 */
import { prisma } from '@/lib/prisma'

async function main() {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "driver_assignments" ADD COLUMN IF NOT EXISTS "sms_sent_to" TEXT',
  )
  const [row] = await prisma.$queryRawUnsafe<Array<{ column_name: string; data_type: string }>>(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'driver_assignments' AND column_name = 'sms_sent_to'`,
  )
  console.log(row ? `ok — sms_sent_to ${row.data_type}` : 'FAILED — column not present')
}

main().finally(() => prisma.$disconnect())
