/**
 * /fleet/today — mobile-first home for fleet/warehouse roles: what
 * departs and returns TODAY (Pacific), with pre-rental inspection
 * status per vehicle. Card tap → that assignment's inspection page.
 *
 * SERVER component: role gate (ADMIN / MANAGER / DISPATCHER /
 * FLEET_TECH) runs here like the sibling inspection page — AGENT/CLIENT
 * get a 403 body with no data fetched. Lives OUTSIDE the (dashboard)
 * group on purpose: no desktop chrome on a phone in the yard; desktop
 * renders as a centered column.
 *
 * Selection logic is lib/fleet/todayBoard.ts — shared with the
 * readiness cron, not re-derived.
 */

import Link from 'next/link'
import { getFleetInspectionUser } from '@/lib/fleet/requireFleetInspectionAccess'
import { fleetMovementsOn, pacificYmd, ymdToDbDate } from '@/lib/fleet/todayBoard'
import { FleetTodayBoard } from '@/components/fleet/FleetTodayBoard'

export const dynamic = 'force-dynamic'

export default async function FleetTodayPage() {
  const user = await getFleetInspectionUser()

  if (!user) {
    return (
      <main className="min-h-screen bg-zinc-900 flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <div className="text-4xl mb-3">🔒</div>
          <h1 className="text-white text-lg font-semibold mb-2">Fleet access required</h1>
          <p className="text-zinc-400 text-sm">
            Fleet Today is limited to fleet ops (admin, manager, dispatcher, fleet tech).
            Sign in at <a className="text-amber-500 underline" href="/login">hq.sirreel.com/login</a> with a fleet account.
          </p>
        </div>
      </main>
    )
  }

  const today = pacificYmd(0)
  const dbDate = ymdToDbDate(today)
  const [departing, returning] = await Promise.all([
    fleetMovementsOn(dbDate, 'start'),
    fleetMovementsOn(dbDate, 'end'),
  ])

  return (
    <main className="min-h-screen bg-zinc-900 px-4 py-6">
      <div className="max-w-md mx-auto">
        <header className="mb-5 flex items-start justify-between">
          <div>
            <div className="text-amber-500 text-xs font-semibold uppercase tracking-wide mb-1">Fleet today</div>
            <h1 className="text-white text-xl font-bold">{today}</h1>
            <p className="text-zinc-500 text-xs mt-0.5">Hi {user.name?.split(' ')[0] || 'there'} — inspections before wheels roll.</p>
          </div>
          <Link href="/dashboard" className="text-zinc-500 text-xs underline mt-1 min-h-[44px] flex items-start pt-1">
            Open HQ →
          </Link>
        </header>
        <FleetTodayBoard initial={{ date: today, departing, returning }} />
      </div>
    </main>
  )
}
