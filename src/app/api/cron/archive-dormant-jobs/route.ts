/**
 * GET /api/cron/archive-dormant-jobs — weekly REPORT on jobs that have
 * gone dormant. It does not archive anything.
 *
 * ── Why report-only ────────────────────────────────────────────────
 *
 * Wes, 2026-08-29, on the auto-archiving version: "Maybe let's be
 * careful on this." He's right, and the reasoning is worth keeping:
 *
 *   - The predicate has already proved subtle. Of 52 jobs with no
 *     activity in 30 days, FOUR were still live — two with future dates.
 *     A rule that delicate should not run unwatched against production
 *     records.
 *   - Archiving is reversible, but only if somebody notices. Nobody
 *     reads audit logs on a Monday morning, so a wrong archive would sit
 *     silently until someone went looking for a job that wasn't there.
 *   - The volume does not justify the risk. Roughly 48 jobs went dormant
 *     over six weeks. Running the sweep by hand once a month is a
 *     minute's work.
 *
 * So the cron does the NOTICING and a human does the ACTING. It raises
 * an Alert naming the count; the sweep is
 * `npx tsx scripts/archive-dormant-jobs.ts --apply`, which shares this
 * exact predicate (src/lib/jobs/dormancy.ts) so the two can never
 * disagree about what dormant means.
 *
 * This route performs NO writes to Job. The only row it creates is the
 * Alert, and it skips even that when there is nothing to say.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { scanDormantJobs, STALE_DAYS } from '@/lib/jobs/dormancy'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ALERT_TYPE = 'jobs_dormant_ready_to_archive'
/** Below this it isn't worth interrupting anyone. */
const ALERT_THRESHOLD = 10

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const scan = await scanDormantJobs()
  const count = scan.dormant.length

  console.log(
    `[cron/archive-dormant-jobs] REPORT ONLY — ${count} dormant of ${scan.total} live. ` +
      `kept: ${JSON.stringify(scan.kept)}`,
  )

  if (count < ALERT_THRESHOLD) {
    return NextResponse.json({
      ok: true,
      reportOnly: true,
      dormant: count,
      total: scan.total,
      kept: scan.kept,
      alerted: false,
    })
  }

  // One open alert at a time — this runs weekly and the same jobs stay
  // dormant until someone sweeps, so re-raising would just stack
  // identical rows.
  const existing = await prisma.alert.findFirst({
    where: {
      type: ALERT_TYPE,
      OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
    },
    select: { id: true },
  })

  if (!existing) {
    const expires = new Date()
    expires.setDate(expires.getDate() + 14)
    await prisma.alert
      .create({
        data: {
          type: ALERT_TYPE,
          title: `${count} jobs ready to archive`,
          body:
            `${count} of ${scan.total} jobs have had no activity in ${STALE_DAYS} days and carry no ` +
            'future dates, open orders, or outstanding balance. Nothing has been archived — run ' +
            '`npx tsx scripts/archive-dormant-jobs.ts` to review, then --apply to archive. ' +
            `Oldest: ${scan.dormant.slice(0, 5).map((d) => d.jobCode).join(', ')}.`,
          severity: 'low',
          link: '/jobs',
          expires_at: expires,
        },
      })
      .catch((err) => console.error('[cron/archive-dormant-jobs] alert write failed:', err))
  }

  return NextResponse.json({
    ok: true,
    reportOnly: true,
    dormant: count,
    total: scan.total,
    kept: scan.kept,
    alerted: !existing,
    jobCodes: scan.dormant.map((d) => d.jobCode),
  })
}
