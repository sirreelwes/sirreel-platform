/**
 * Additive ALTER for SmsMessage.driverAssignmentId (2026-09-15) — lets the
 * job page say whether a driver's invite text actually reached them.
 *
 * Run BEFORE the code that selects it deploys (a default select against a
 * missing column 500s the route). `db push` is not usable here — live
 * drift makes it propose DROPs.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-sms-driver-assignment-column.ts
 */
import { prisma } from '@/lib/prisma'

async function main() {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "sr_sms_messages" ADD COLUMN IF NOT EXISTS "driver_assignment_id" TEXT',
  )
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "sr_sms_messages_driver_assignment_id_idx" ON "sr_sms_messages" ("driver_assignment_id")',
  )
  const [col] = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sr_sms_messages' AND column_name = 'driver_assignment_id'`,
  )
  console.log(col ? 'ok — driver_assignment_id present' : 'FAILED — column not present')
}

main().finally(() => prisma.$disconnect())
