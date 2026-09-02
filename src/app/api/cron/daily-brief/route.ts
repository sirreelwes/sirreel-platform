import { NextRequest, NextResponse } from 'next/server'
import { buildDailyBrief, type BriefEdition } from '@/lib/email/dailyBrief'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/daily-brief?edition=morning|evening — the twice-daily
 * operations email (Wes 2026-09-02: 6am and 5pm Pacific).
 *
 * DST, and why the schedule looks odd in vercel.json: Vercel crons are UTC
 * only, so a fixed UTC time drifts an hour twice a year — a "6am" brief
 * would land at 5am all winter. Each edition is therefore scheduled at BOTH
 * candidate UTC hours (PDT and PST) and this route drops the one that is
 * not the intended Pacific hour. Two invocations a day, one send, correct
 * in both halves of the year.
 *
 * `?preview=1` renders and returns the HTML without sending — for looking
 * at the thing before it goes to the team.
 *
 * Manual run:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://hq.sirreel.com/api/cron/daily-brief?edition=evening"
 */

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`
}

const TARGET_HOUR: Record<BriefEdition, number> = { morning: 6, evening: 17 }

function pacificHour(d: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      hour12: false,
    }).format(d),
  )
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const editionParam = req.nextUrl.searchParams.get('edition')
  const edition: BriefEdition = editionParam === 'morning' ? 'morning' : 'evening'
  const preview = req.nextUrl.searchParams.get('preview') === '1'
  const force = req.nextUrl.searchParams.get('force') === '1'

  const now = new Date()
  const hour = pacificHour(now)
  if (!preview && !force && hour !== TARGET_HOUR[edition]) {
    // The other DST twin fired. Not an error.
    return NextResponse.json({
      ok: true,
      skipped: 'wrong Pacific hour for this edition',
      edition,
      pacificHour: hour,
      wanted: TARGET_HOUR[edition],
    })
  }

  const brief = await buildDailyBrief(edition, now)

  if (preview) {
    return new NextResponse(brief.html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  const to = await channelRecipients('daily-brief')
  if (to.length === 0) {
    return NextResponse.json({ ok: true, skipped: 'no recipients on the daily-brief channel' })
  }

  const sent = await sendAgreementEmail({
    to,
    subject: brief.subject,
    html: brief.html,
    text: brief.text,
    label: `daily-brief:${edition}`,
  })

  return NextResponse.json({
    ok: sent.ok,
    edition,
    focusDay: brief.focusDay,
    to: to.length,
    counts: brief.counts,
    ...(sent.ok ? {} : { reason: sent.reason }),
  })
}
