/**
 * GET /api/cron/company-portal-notices — the account portal's outbound
 * notices.
 *
 * Runs once a day. Detects what happened (jobs started, invoices paid,
 * shows closed, quotes sent), sends to the executives who elected to hear
 * about it, and on Mondays flushes the weekly digest queue.
 *
 * All the reasoning about idempotency, the lookback window and claim-
 * before-send lives in src/lib/portal/companyPortalNotices.ts — this route
 * is the trigger and nothing else.
 *
 * `?dryRun=1` reports what WOULD go out without claiming or sending, which
 * is how to check the sweep after changing a detection rule without
 * mailing a client to find out.
 *
 * Trigger manually with:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://hq.sirreel.com/api/cron/company-portal-notices?dryRun=1
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  runCompanyPortalNotices,
  runCompanyPortalDigests,
} from '@/lib/portal/companyPortalNotices'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'
  const now = new Date()

  try {
    const sweep = await runCompanyPortalNotices(now, { dryRun })

    // Monday flushes the weekly queue. `?digest=1` forces it for a manual
    // run on any day.
    const isMonday = now.getUTCDay() === 1
    const forceDigest = req.nextUrl.searchParams.get('digest') === '1'
    const digest =
      !dryRun && (isMonday || forceDigest) ? await runCompanyPortalDigests() : { sent: 0, failed: 0 }

    return NextResponse.json({ ok: true, dryRun, sweep, digest })
  } catch (err) {
    console.error('[cron/company-portal-notices] failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'sweep failed' },
      { status: 500 },
    )
  }
}
