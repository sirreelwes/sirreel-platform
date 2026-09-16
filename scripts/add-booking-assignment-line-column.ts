/**
 * Add the line link to booking_assignments — with ADDITIVE SQL, not
 * `prisma db push` (the live DB carries objects no schema file knows;
 * a push would drop them — see scripts/add-partner-photo-columns.ts).
 *
 *   order_line_item_id   OrderLineItem id — WHICH LINE of the order this
 *                        reserved unit is (nullable; SET NULL when the
 *                        line goes, which is why the line delete path
 *                        reads it before deleting)
 *
 * Wes 2026-09-16: "If we remove a cube truck from an order, it should be
 * a specific cube truck so that, in that order line, we can even see
 * cube 34 … They need to be tied together." Idempotent; safe to re-run.
 * RUN BEFORE the code deploys — the order GET selects the column.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-booking-assignment-line-column.ts
 */
import { prisma } from '../src/lib/prisma'

const TABLE = 'booking_assignments'
const STATEMENTS = [
  `ALTER TABLE "${TABLE}" ADD COLUMN IF NOT EXISTS "order_line_item_id" TEXT`,
  `CREATE INDEX IF NOT EXISTS "${TABLE}_order_line_item_id_idx" ON "${TABLE}"("order_line_item_id")`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql}`)
  }
  // The foreign key separately: ADD CONSTRAINT has no IF NOT EXISTS, so it
  // is guarded by a catalog read. SET NULL on delete — the line going
  // away must never take the unit off the reservation on its own.
  const fk = `${TABLE}_order_line_item_id_fkey`
  const have = await prisma.$queryRawUnsafe<{ conname: string }[]>(
    `SELECT conname FROM pg_constraint WHERE conname = '${fk}'`,
  )
  if (have.length === 0) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${fk}" FOREIGN KEY ("order_line_item_id") REFERENCES "sr_order_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    )
    console.log(`✓ constraint ${fk}`)
  } else {
    console.log(`= constraint ${fk} already present`)
  }
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = '${TABLE}' AND column_name IN ('order_id','order_line_item_id') ORDER BY ordinal_position`,
  )
  console.log('link columns now:', cols.map((c) => c.column_name).join(', '))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
