/**
 * Add sr_vendor_contacts — the people at a partner — with ADDITIVE SQL, not
 * `prisma db push` (the live DB carries objects in no schema file; a push
 * would drop them).
 *
 * Wes 2026-09-11: "I need to be able to add people on the partner portal.
 * owners and others. let's have a contacts section."
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-vendor-contacts-table.ts
 *
 * Idempotent: every statement is IF NOT EXISTS. Nothing existing is touched —
 * Vendor.contactName/email/phone stay exactly where they are, and the primary
 * contact row mirrors into them (lib/sub-rentals/vendorContacts.ts).
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "sr_vendor_contacts" (
     "id" TEXT NOT NULL,
     "vendor_id" TEXT NOT NULL,
     "name" TEXT NOT NULL,
     "email" TEXT,
     "phone" VARCHAR(30),
     "role" TEXT NOT NULL DEFAULT 'OTHER',
     "notes" TEXT,
     "is_primary" BOOLEAN NOT NULL DEFAULT false,
     "email_bookings" BOOLEAN NOT NULL DEFAULT false,
     "added_by_partner" BOOLEAN NOT NULL DEFAULT false,
     "is_active" BOOLEAN NOT NULL DEFAULT true,
     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "sr_vendor_contacts_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "sr_vendor_contacts_vendor_id_email_key" ON "sr_vendor_contacts" ("vendor_id", "email")`,
  `CREATE INDEX IF NOT EXISTS "sr_vendor_contacts_vendor_id_idx" ON "sr_vendor_contacts" ("vendor_id")`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql.split('\n')[0].trim()}`)
  }
  // The foreign key separately: ADD CONSTRAINT has no IF NOT EXISTS, so it is
  // guarded by a lookup and re-running stays a no-op.
  const [fk] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM pg_constraint WHERE conname = 'sr_vendor_contacts_vendor_id_fkey'`,
  )
  if (Number(fk.n) === 0) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "sr_vendor_contacts" ADD CONSTRAINT "sr_vendor_contacts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    )
    console.log('✓ foreign key → vendors(id)')
  } else {
    console.log('· foreign key already there')
  }
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'sr_vendor_contacts' ORDER BY ordinal_position`,
  )
  console.log('sr_vendor_contacts:', cols.map((c) => c.column_name).join(', '))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
