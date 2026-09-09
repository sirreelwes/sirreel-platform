import { NextRequest, NextResponse } from 'next/server'
import { requireTeamMetricsUser } from '@/lib/team/access'
import { teamReports } from '@/lib/team/metrics'

/**
 * GET /api/team/metrics?days=30 — every watched person's report for the
 * window, each paired against their own preceding window.
 *
 * Computed live rather than stored. It is a handful of counts plus one
 * bounded pass over mail, and caching a judgement about a named employee
 * means serving a stale one — if the number is worth acting on it should be
 * the number as of now.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const ALLOWED_WINDOWS = new Set([7, 30, 90])
const DEFAULT_DAYS = 30

export async function GET(req: NextRequest) {
  const user = await requireTeamMetricsUser()
  if (user instanceof NextResponse) return user

  const raw = Number(req.nextUrl.searchParams.get('days'))
  const days = ALLOWED_WINDOWS.has(raw) ? raw : DEFAULT_DAYS

  const out = await teamReports(days)
  return NextResponse.json(out)
}
