/**
 * VendorContact.sms_bookings + sms_consent_at — ADDITIVE SQL, not
 * `prisma db push` (the live DB carries objects in no schema file).
 *
 * Wes 2026-09-15: a partner may choose to hear about bookings by text.
 * Run BEFORE the deploy that reads the columns; until then every read of
 * sr_vendor_contacts with the new fields would 500.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-partner-sms-columns.ts
 *
 * Idempotent.
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `ALTER TABLE sr_vendor_contacts ADD COLUMN IF NOT EXISTS sms_bookings boolean NOT NULL DEFAULT false`,
  `ALTER TABLE sr_vendor_contacts ADD COLUMN IF NOT EXISTS sms_consent_at timestamp(3)`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql}`)
  }
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'sr_vendor_contacts' AND column_name IN ('sms_bookings','sms_consent_at') ORDER BY column_name`,
  )
  console.log('present:', cols.map((c) => c.column_name).join(', ') || 'NONE')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
