/**
 * GET /api/cron/release-driver-locations — daily, 22:00 UTC (3pm Pacific).
 *
 * Partner drivers don't get the delivery location until the day before
 * (Wes 2026-09-07). This mails every driver whose unit goes out TOMORROW
 * the exact address, gate notes and on-site contact, and stamps the
 * release. See conduit.releaseDriverLocations for the rules.
 */
import { NextRequest, NextResponse } from 'next/server'
import { releaseDriverLocations } from '@/lib/sub-rentals/conduit'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && (req.headers.get('authorization') || '') !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ ok: true, ...(await releaseDriverLocations()) })
}
