/**
 * GET /api/cron/driver-requests — the 48-hour "who's driving?" ask.
 *
 * Runs every weekday and weekend morning (Pacific): a shoot starting
 * Saturday needs its driver named on Thursday, so this cannot be a
 * Mon–Fri job like the pick-list sweep.
 *
 * Rules, timing and suppression all live in sweepDriverRequests() —
 * see that file. This route is the trigger and the auth check.
 *
 * Preview what a run WOULD send, without mailing anybody:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://hq.sirreel.com/api/cron/driver-requests?dry=1"
 */
import { NextRequest, NextResponse } from 'next/server'
import { sweepDriverRequests } from '@/lib/drivers/driverRequestSweep'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const dryRun = ['1', 'true'].includes((req.nextUrl.searchParams.get('dry') || '').toLowerCase())
  const result = await sweepDriverRequests({ dryRun })

  if (result.sent.length > 0) {
    console.log('[cron/driver-requests]', JSON.stringify({
      dryRun: result.dryRun,
      sent: result.sent.map((s) => `${s.jobCode ?? s.jobId} → ${s.sentTo} (${s.vehicles.length} unit${s.vehicles.length === 1 ? '' : 's'}, starts ${s.startDate})`),
    }))
  }
  return NextResponse.json({ ok: true, ...result })
}
