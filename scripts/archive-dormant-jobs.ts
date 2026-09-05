/**
 * Archive dormant jobs so /jobs shows current work.
 *
 * Wes, 2026-08-29: "we really don't need to have old jobs that
 * accessible. just archived. Anything older than 30 days is unnecessary
 * to be on the main access page."
 *
 * Archiving is the right mechanism rather than a new filter: the list
 * API already excludes `archivedAt IS NOT NULL` by default, and the
 * toolbar already carries an "Archived" status option, so an archived
 * job leaves the main page and stays reachable — no new code path, and
 * nothing to keep in sync.
 *
 * ── "Older than 30 days" needs a safe definition ───────────────────
 *
 * NOT by creation date. A job raised in June for an October shoot is
 * live work, and hiding it would be the worst possible outcome of a
 * tidy-up. Measured before writing this: of 52 jobs with no activity in
 * 30 days, FOUR were still live — "Extended Stay" and "Desigual x DL
 * #2603" both have future dates, and two more carry open orders. A naive
 * date cut would have buried real upcoming rentals.
 *
 * So a job is archived only when ALL FOUR hold:
 *
 *   1. No activity in 30 days — newest of Job.updatedAt and every
 *      order's updatedAt / quoteSentAt.
 *   2. No future dates — nothing on the job, its orders, or its
 *      non-cancelled bookings falls on or after today.
 *   3. No open order — every order is CANCELLED or CLOSED.
 *   4. Nothing owed — no non-void invoice with a balance.
 *
 * Any one of those keeps the job on the main page regardless of age.
 *
 * Fully reversible: archivedAt goes back to null, the ids are captured
 * to journals/, and an AuditLog row is written per job so a revert is
 * possible from the database alone.
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   npx tsx scripts/archive-dormant-jobs.ts           # dry run
 *   npx tsx scripts/archive-dormant-jobs.ts --apply   # archive
 */

import { PrismaClient } from '@prisma/client'
import { writeFileSync, mkdirSync } from 'fs'
// ONE definition of dormancy, shared with /api/cron/archive-dormant-jobs.
// If these drifted, the cron would archive jobs this script calls live.
import { scanDormantJobs, STALE_DAYS as SHARED_STALE_DAYS } from '../src/lib/jobs/dormancy'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const daysArg = process.argv.indexOf('--days')
const STALE_DAYS = daysArg >= 0 ? Number(process.argv[daysArg + 1]) : SHARED_STALE_DAYS

const OPERATOR_EMAIL = 'wes@sirreel.com'
const AUDIT_ACTION = 'job.archive_dormant'

async function main() {
  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (pass --apply to archive) ===')
  console.log(`Staleness window: ${STALE_DAYS} days\n`)

  const operator = await prisma.user.findFirst({
    where: { email: OPERATOR_EMAIL },
    select: { id: true },
  })
  if (!operator) throw new Error(`No User row for ${OPERATOR_EMAIL} — refusing to write unattributed rows`)

  const now = new Date()
  const scan = await scanDormantJobs(now, STALE_DAYS)
  console.log(`Live (non-archived) jobs: ${scan.total}`)

  const eligible = scan.dormant
  const kept = scan.kept

  console.log('\nKEPT on the main page:')
  console.log(`  active in the last ${STALE_DAYS} days : ${kept['recent-activity']}`)
  console.log(`  stale but has FUTURE DATES      : ${kept['future-dates']}`)
  console.log(`  stale but has an OPEN ORDER     : ${kept['open-order']}`)
  console.log(`  stale but MONEY IS OWED         : ${kept['owes-money']}`)
  console.log(`\nTO ARCHIVE: ${eligible.length}`)
  eligible.slice(0, 15).forEach((e) =>
    console.log(`  ${e.jobCode}  ${e.name.slice(0, 40).padEnd(40)} last activity ${e.lastActivity}`))
  if (eligible.length > 15) console.log(`  … and ${eligible.length - 15} more`)
  console.log(`\nMain page would show ${scan.total - eligible.length} of ${scan.total}.`)

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to archive.')
    return
  }
  if (eligible.length === 0) {
    console.log('\nNothing to archive.')
    return
  }

  mkdirSync('journals', { recursive: true })
  const path = `journals/archive-dormant-jobs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(path, JSON.stringify({ archivedJobIds: eligible.map((e) => e.id), jobs: eligible }, null, 2))

  const archivedAt = new Date()
  const res = await prisma.job.updateMany({
    where: { id: { in: eligible.map((e) => e.id) }, archivedAt: null },
    data: { archivedAt },
  })

  await prisma.auditLog.createMany({
    data: eligible.map((e) => ({
      action: AUDIT_ACTION,
      entityType: 'Job',
      entityId: e.id,
      userId: operator.id,
      oldValues: { archivedAt: null },
      newValues: { archivedAt: archivedAt.toISOString() },
    })),
  }).catch((err) => console.error('[audit] write failed (archive stands):', err))

  console.log(`\nArchived ${res.count} jobs.`)
  console.log(`Reversal list: ${path} — set archivedAt back to null BY THESE IDS to undo.`)
  console.log('They remain reachable from the Archived filter on /jobs.')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
