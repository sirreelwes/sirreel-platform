/**
 * GET /api/fleet/today — data feed for the /fleet/today mobile board
 * (refresh + pull-to-refresh). Departing/returning assignments for the
 * current Pacific day via the shared todayBoard selection (same logic
 * as the readiness cron). Role-gated: ADMIN / MANAGER / DISPATCHER /
 * FLEET_TECH.
 */

import { NextResponse } from 'next/server'
import { requireFleetInspectionAccess } from '@/lib/fleet/requireFleetInspectionAccess'
import { fleetMovementsOn, pacificYmd, ymdToDbDate } from '@/lib/fleet/todayBoard'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireFleetInspectionAccess()
  if (!auth.ok) return auth.response

  const today = pacificYmd(0)
  const dbDate = ymdToDbDate(today)
  const [departing, returning] = await Promise.all([
    fleetMovementsOn(dbDate, 'start'),
    fleetMovementsOn(dbDate, 'end'),
  ])
  return NextResponse.json({ date: today, departing, returning })
}
