/**
 * GET /api/cron/client-created-notice — 7:00 AM Pacific, every day.
 *
 * Wes 2026-09-08: a client-created job gets "a real time email if during
 * biz hours" and otherwise "an hq@ notification email to go out at 7a on
 * the next business day."
 *
 * The real-time half lives in the submit itself (lib/public/agreementEntry
 * .ts). This is the other half: everything that came in while the lot was
 * closed and therefore has no `AgreementEntry.teamNotifiedAt`.
 *
 * "The next BUSINESS day" is why Sunday is skipped — a Saturday-evening
 * signature waits for Monday 7am rather than landing in a Sunday inbox
 * nobody is reading. Saturday itself still runs: the lot opens at 7am and
 * a Friday-night job should not wait until Monday.
 *
 * Scheduled on both UTC twins (14:00 and 15:00) so it lands at 7am Pacific
 * through the DST change, and guarded on the Pacific hour so only one of
 * them does the work — the pattern daily-brief established.
 */
import { NextRequest, NextResponse } from 'next/server'
import { previewClientCreatedNotices, sweepClientCreatedNotices } from '@/lib/email/notifyClientCreatedJob'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TZ = 'America/Los_Angeles'
const TARGET_HOUR = 7

function pacific(d: Date): { hour: number; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false, weekday: 'short' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  )
  return {
    hour: Number(parts.hour) % 24,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(parts.weekday)),
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && (req.headers.get('authorization') || '') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const force = req.nextUrl.searchParams.get('force') === '1'
  // Read the email without sending it — for a person checking the copy,
  // and for a test that must not put anything in an inbox.
  if (req.nextUrl.searchParams.get('preview') === '1') {
    return NextResponse.json({ ok: true, preview: await previewClientCreatedNotices() })
  }
  const now = new Date()
  const { hour, weekday } = pacific(now)

  if (!force && hour !== TARGET_HOUR) {
    // The other DST twin fired. Not an error.
    return NextResponse.json({ ok: true, skipped: 'not 7am Pacific', pacificHour: hour })
  }
  if (!force && weekday === 0) {
    return NextResponse.json({ ok: true, skipped: 'Sunday — these wait for Monday' })
  }

  return NextResponse.json({ ok: true, ...(await sweepClientCreatedNotices(now)) })
}
