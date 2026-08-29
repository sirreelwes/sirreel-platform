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
 * to tmp/, and an AuditLog row is written per job so a revert is
 * possible from the database alone.
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   npx tsx scripts/archive-dormant-jobs.ts           # dry run
 *   npx tsx scripts/archive-dormant-jobs.ts --apply   # archive
 */

import { PrismaClient } from '@prisma/client'
import { writeFileSync, mkdirSync } from 'fs'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const daysArg = process.argv.indexOf('--days')
const STALE_DAYS = daysArg >= 0 ? Number(process.argv[daysArg + 1]) : 30

const OPERATOR_EMAIL = 'wes@sirreel.com'
const AUDIT_ACTION = 'job.archive_dormant'
const DAY = 86_400_000

async function main() {
  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (pass --apply to archive) ===')
  console.log(`Staleness window: ${STALE_DAYS} days\n`)

  const operator = await prisma.user.findFirst({
    where: { email: OPERATOR_EMAIL },
    select: { id: true },
  })
  if (!operator) throw new Error(`No User row for ${OPERATOR_EMAIL} — refusing to write unattributed rows`)

  const now = new Date()
  const cutoff = new Date(now.getTime() - STALE_DAYS * DAY)
  const today = new Date(now.toISOString().slice(0, 10))

  const jobs = await prisma.job.findMany({
    where: { archivedAt: null },
    select: {
      id: true, jobCode: true, name: true, status: true,
      createdAt: true, updatedAt: true, startDate: true, endDate: true,
      orders: {
        select: {
          status: true, updatedAt: true, quoteSentAt: true, startDate: true, endDate: true,
          invoices: { select: { balanceDue: true, status: true } },
        },
      },
      bookings: { select: { status: true, startDate: true, endDate: true } },
    },
  })
  console.log(`Live (non-archived) jobs: ${jobs.length}`)

  type J = (typeof jobs)[number]
  const lastActivity = (j: J) =>
    [j.updatedAt, ...j.orders.flatMap((o) => [o.updatedAt, o.quoteSentAt].filter(Boolean) as Date[])]
      .reduce((max, d) => (d > max ? d : max), j.updatedAt)

  const hasFutureDate = (j: J) =>
    ([
      j.startDate, j.endDate,
      ...j.orders.flatMap((o) => [o.startDate, o.endDate]),
      ...j.bookings.filter((b) => b.status !== 'CANCELLED').flatMap((b) => [b.startDate, b.endDate]),
    ].filter(Boolean) as Date[]).some((d) => d >= today)

  const hasOpenOrder = (j: J) =>
    j.orders.some((o) => o.status !== 'CANCELLED' && o.status !== 'CLOSED')

  const owesMoney = (j: J) =>
    j.orders.some((o) =>
      o.invoices.some((inv) => Number(inv.balanceDue ?? 0) > 0 && inv.status !== 'VOID'),
    )

  const eligible: { id: string; jobCode: string; name: string; last: string }[] = []
  const kept = { recentActivity: 0, futureDates: 0, openOrder: 0, owesMoney: 0 }

  for (const j of jobs) {
    if (lastActivity(j) >= cutoff) { kept.recentActivity += 1; continue }
    if (hasFutureDate(j)) { kept.futureDates += 1; continue }
    if (hasOpenOrder(j)) { kept.openOrder += 1; continue }
    if (owesMoney(j)) { kept.owesMoney += 1; continue }
    eligible.push({
      id: j.id, jobCode: j.jobCode, name: j.name,
      last: lastActivity(j).toISOString().slice(0, 10),
    })
  }

  console.log('\nKEPT on the main page:')
  console.log(`  active in the last ${STALE_DAYS} days : ${kept.recentActivity}`)
  console.log(`  stale but has FUTURE DATES      : ${kept.futureDates}`)
  console.log(`  stale but has an OPEN ORDER     : ${kept.openOrder}`)
  console.log(`  stale but MONEY IS OWED         : ${kept.owesMoney}`)
  console.log(`\nTO ARCHIVE: ${eligible.length}`)
  eligible.slice(0, 15).forEach((e) =>
    console.log(`  ${e.jobCode}  ${e.name.slice(0, 40).padEnd(40)} last activity ${e.last}`))
  if (eligible.length > 15) console.log(`  … and ${eligible.length - 15} more`)
  console.log(`\nMain page would show ${jobs.length - eligible.length} of ${jobs.length}.`)

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to archive.')
    return
  }
  if (eligible.length === 0) {
    console.log('\nNothing to archive.')
    return
  }

  mkdirSync('tmp', { recursive: true })
  const path = `tmp/archive-dormant-jobs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
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
