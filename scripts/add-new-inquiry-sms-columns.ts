/**
 * Additive columns for the "new incoming" SMS alert (Wes 2026-09-11:
 * "Can [HQ] text me when there's a new incoming and drop a link in the
 * text to open that response?").
 *
 *   sr_inquiries.sms_notified_at — the alert queue. NULL = not texted yet.
 *   sr_inquiries.sms_nudged_at   — the follow-up queue (Wes 2026-09-12:
 *                                  "one nudge after 1 hr"). NULL = not
 *                                  nudged yet.
 *
 * ADDITIVE SQL, not `prisma db push`: the live DB carries sr_job_locations
 * and nine sub_rentals address columns that exist in no schema file, so a
 * push from this tree DROPS them. See the migrate-diff note in CLAUDE.md.
 *
 * THE BACKFILL IS THE POINT. Every existing NEW inquiry would otherwise
 * have a NULL stamp, and the first sweep after deploy would text Wes about
 * a backlog of old leads. Stamping them on creation makes the column mean
 * "nothing before this moment is new", which is true.
 *
 * Idempotent — safe to re-run. Run it BEFORE the code that reads the column
 * is live: any Prisma query on Inquiry without an explicit `select` selects
 * every schema column and throws P2022 if the DB lacks one. A
 * committed-but-unrun column script did exactly that to every Vendor query
 * on 2026-09-11.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-new-inquiry-sms-columns.ts
 */
import { PrismaClient } from '@prisma/client'
import { NEW_INQUIRY_SMS_RECIPIENT } from '../src/lib/sales/notifyNewInquirySms'

const prisma = new PrismaClient()

async function main() {
  console.log('Adding columns (IF NOT EXISTS — additive only)…')
  await prisma.$executeRawUnsafe(
    `ALTER TABLE sr_inquiries ADD COLUMN IF NOT EXISTS sms_notified_at TIMESTAMP(3)`,
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE sr_inquiries ADD COLUMN IF NOT EXISTS sms_nudged_at TIMESTAMP(3)`,
  )

  // Prove they landed rather than trusting the ALTERs' exit codes.
  const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sr_inquiries' AND column_name IN ('sms_notified_at', 'sms_nudged_at')`,
  )
  if (cols.length !== 2) throw new Error(`expected both columns; information_schema has: ${cols.map((c) => c.column_name).join(', ') || 'neither'}`)
  console.log('information_schema confirms sms_notified_at + sms_nudged_at')

  // Backfill: everything that already exists is not "new", and must not be
  // nudged about either — the nudge queue reads rows that HAVE been notified,
  // so leaving these NULL would fire a follow-up about every old lead.
  const stamped = await prisma.$executeRawUnsafe(
    `UPDATE sr_inquiries SET sms_notified_at = NOW() WHERE sms_notified_at IS NULL`,
  )
  console.log(`Backfilled ${stamped} existing inquiries as already-notified.`)
  const nudged = await prisma.$executeRawUnsafe(
    `UPDATE sr_inquiries SET sms_nudged_at = NOW() WHERE sms_nudged_at IS NULL`,
  )
  console.log(`Backfilled ${nudged} existing inquiries as already-nudged.`)

  const who = await prisma.user.findFirst({
    where: { email: NEW_INQUIRY_SMS_RECIPIENT, isActive: true },
    select: { email: true, phone: true },
  })
  console.log(
    `\nAlerts go to ${NEW_INQUIRY_SMS_RECIPIENT} — ` +
      (who ? (who.phone ? `phone on file: ${who.phone}` : 'NO PHONE ON FILE, nothing will send') : 'NO ACTIVE USER ROW, nothing will send'),
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
