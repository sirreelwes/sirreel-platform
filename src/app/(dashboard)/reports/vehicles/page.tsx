/**
 * /reports/vehicles — Vehicle Check In/Out.
 *
 * Hugo, 2026-09-03: "we need Vehicle Check Out/In tabs on left too.
 * This is just like order checkin/out — basically our Damage ID tab."
 *
 * The three screens of a vehicle's arc already existed and were only
 * reachable as deep links off /yard, one day at a time:
 *   /fleet/inspection/[id] — the pre-rental walk-around (condition)
 *   /fleet/pickup/[id]     — the handover, when the driver turns up
 *   /fleet/return/[id]     — the return inspection, compared to the above
 *
 * So this is not a fourth flow. It is the LIST those three were missing:
 * every truck going out and coming back over a visible horizon, with the
 * state of each end of its arc on the row, so a supervisor can see at a
 * glance which trucks still owe a report instead of walking the day board
 * forward one tap at a time.
 *
 * SERVER component: the yard gate runs here, and the rows are read
 * through fleetMovementsOn — the same selection the readiness cron and
 * the yard board use, so the three cannot drift.
 */

import Link from 'next/link'
import { Lock, Car, ArrowRight, Check, ClipboardList, KeyRound, History } from 'lucide-react'
import { getYardUser } from '@/lib/yard/requireYardAccess'
import { CheckEdgeTabs } from '@/components/reports/CheckEdgeTabs'
import { VehicleBlindToggle } from '@/components/fleet/VehicleBlindToggle'
import { checkWindowYmds, fleetMovementsBetween, pacificYmd, ymdToDbDate, type FleetMovement } from '@/lib/fleet/todayBoard'

export const dynamic = 'force-dynamic'

/**
 * How far ahead and behind the list reaches. Forward is the planning
 * window a supervisor needs to see coming; backward exists so a truck
 * that came in yesterday and never got checked in is still on screen
 * accusing someone, rather than silently dropping off the board.
 *
 * Backward is counted in days the yard WORKS, not calendar days — see
 * checkWindowYmds. It was two calendar days, which meant Friday's
 * returns were gone by Monday morning: Oliver, 2026-09-14, "Fox Sports
 * Cube 33 returned on Friday. Julian wants to check it in, but it's not
 * visible in the vehicle check in/out tab." Three open days matches the
 * order check list this one is twinned with (REPORT_DAYS_BACK).
 */
const DAYS_BACK = 3
const DAYS_FORWARD = 6

/**
 * How far PAST the window the "never checked in" tail reaches.
 *
 * Widening the window fixed the Friday-to-Monday gap, but not the shape
 * of it: a return that nobody files by the following Wednesday drops off
 * again, and the return screen has no other route in — /fleet/return
 * wants an assignment id, and the history page only lists walk-arounds
 * that WERE filed. So there was no way to check in a truck that had
 * already slipped, only a list that quietly stopped mentioning it.
 *
 * The tail is bounded on purpose. Every return has to stay reachable for
 * long enough to be caught up on, but a queue that never forgets is an
 * archive, and it stops being read. A week past the window is the
 * catch-up horizon; older than that is a conversation, not a form.
 */
const UNFILED_TAIL_DAYS = 7

function dayLabel(ymd: string, today: string): string {
  if (ymd === today) return 'Today'
  const [y, m, d] = ymd.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

const DAY_MS = 86_400_000

/** The window is contiguous, so it is one range read per edge rather
 *  than the day-at-a-time loop this page opened with. */
function loadEdge(days: string[], edge: 'start' | 'end'): Promise<FleetMovement[]> {
  return fleetMovementsBetween(ymdToDbDate(days[0]), ymdToDbDate(days[days.length - 1]), edge)
}

/** Returns that fell out of the back of the window still owing a
 *  check-in. Filed ones are deliberately dropped — those are finished,
 *  and they live on the history page. */
async function loadUnfiledTail(windowStart: string): Promise<FleetMovement[]> {
  const startMs = ymdToDbDate(windowStart).getTime()
  const rows = await fleetMovementsBetween(
    new Date(startMs - UNFILED_TAIL_DAYS * DAY_MS),
    new Date(startMs - DAY_MS),
    'end',
  )
  return rows.filter((r) => !r.returnInspection)
}

export default async function VehicleReportsPage() {
  const user = await getYardUser()
  if (!user) {
    return (
      <div className="max-w-sm mx-auto text-center py-16 px-6">
        <Lock size={32} aria-hidden className="mx-auto mb-3 text-lt-fg3" />
        <h1 className="text-lt-fg text-lg font-semibold mb-2">Yard access required</h1>
        <p className="text-lt-fg2 text-sm">
          Vehicle check in/out is for fleet and warehouse staff. Ask Wes or Hugo if you need it.
        </p>
      </div>
    )
  }

  const today = pacificYmd(0)
  // Read once: three reads of the clock could straddle midnight and give
  // the two lanes and the tail slightly different windows.
  const days = checkWindowYmds(DAYS_BACK, DAYS_FORWARD)
  const [out, back, unfiled] = await Promise.all([
    loadEdge(days, 'start'),
    loadEdge(days, 'end'),
    loadUnfiledTail(days[0]),
  ])

  return (
    <div className="max-w-4xl mx-auto px-1 py-2">
      <header className="mb-5">
        <div className="text-amber-700 text-xs font-semibold uppercase tracking-wide mb-1">Vehicles</div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h1 className="text-lt-fg text-2xl font-bold">Check In/Out</h1>
          {/* This list is a work queue about a week and a half wide. Every walk-around
              ever filed lives in the record (Wes, 2026-09-14: "they need
              to be able to go back and see previous check in check out
              forms"). */}
          <Link
            href="/reports/vehicles/history"
            className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-lt-fg2 hover:text-lt-fg border border-lt-hairline rounded-lg px-3 py-1.5"
          >
            <History size={15} aria-hidden /> Past walk-arounds
          </Link>
        </div>
        <p className="text-lt-fg2 text-sm mt-0.5 max-w-[70ch]">
          The walk-around at both ends of a rental, one end at a time. Check out is the condition
          report plus the handover to the driver; check in is the return, compared side by side
          against what went out.
        </p>
      </header>

      {/* Oliver, 2026-09-08: "a toggle at the top of the page, that way
          they're separate." Both lanes are still built here on the
          server; the tabs only choose which one is shown. */}
      <CheckEdgeTabs
        outDue={out.filter((r) => !r.inspection).length}
        backDue={back.filter((r) => !r.returnInspection).length}
        out={
          <Lane
            title="Check out — going out"
            empty="Nothing scheduled to go out in this window."
            rows={out}
            today={today}
            edge="out"
          />
        }
        back={
          <>
            <Lane
              title="Check in — coming back"
              empty="Nothing due back in this window."
              rows={back}
              today={today}
              edge="back"
            />
            <UnfiledTail rows={unfiled} today={today} />
          </>
        }
      />
    </div>
  )
}

function Lane({
  title, empty, rows, today, edge,
}: {
  title: string
  empty: string
  rows: FleetMovement[]
  today: string
  edge: 'out' | 'back'
}) {
  // Chronological, and inside a day by unit so the same truck lands in
  // the same place on both lanes.
  const sorted = [...rows].sort(
    (a, b) => a.edgeDate.localeCompare(b.edgeDate) || a.unitName.localeCompare(b.unitName),
  )
  const days = [...new Set(sorted.map((r) => r.edgeDate))]

  return (
    <section className="mb-8">
      <h2 className="text-lt-fg text-[15px] font-semibold uppercase tracking-wide mb-2">{title}</h2>
      {sorted.length === 0 ? (
        <p className="text-lt-fg2 text-[15px] border border-lt-hairline bg-lt-card rounded-lg px-4 py-6 text-center">{empty}</p>
      ) : (
        days.map((ymd) => (
          <div key={ymd} className="mb-4">
            <div className={`text-[12px] font-bold uppercase tracking-[0.16em] mb-1.5 ${
              ymd === today ? 'text-amber-600' : 'text-lt-fg3'
            }`}>
              {dayLabel(ymd, today)}
            </div>
            <div className="space-y-1.5">
              {sorted.filter((r) => r.edgeDate === ymd).map((r) => (
                <VehicleRow key={`${r.assignmentId}-${edge}`} row={r} edge={edge} />
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  )
}

/**
 * Returns that fell out of the back of the window without a check-in.
 *
 * Collapsed, and deliberately not counted on the tab: the tab's number
 * is the work in front of the crew today, and burying that under a
 * backlog would make it useless. This is the escape hatch — the truck
 * you are holding the keys to is in here when it is no longer on the
 * board, instead of being unreachable.
 *
 * It renders nothing when it is empty, which is the state to aim for.
 */
function UnfiledTail({ rows, today }: { rows: FleetMovement[]; today: string }) {
  if (rows.length === 0) return null
  const sorted = [...rows].sort(
    (a, b) => b.edgeDate.localeCompare(a.edgeDate) || a.unitName.localeCompare(b.unitName),
  )

  return (
    <details className="mb-8 border border-lt-hairline rounded-lg bg-lt-card">
      <summary className="cursor-pointer list-none px-4 py-3 text-[15px] font-semibold text-lt-fg2 hover:text-lt-fg flex items-center gap-2">
        <History size={15} aria-hidden className="flex-none" />
        Earlier returns never checked in
        <span className="text-[12px] font-bold rounded-full px-1.5 py-0.5 bg-chip-warn-bg text-chip-warn-fg">
          {sorted.length}
        </span>
      </summary>
      <div className="px-4 pb-4">
        <p className="text-lt-fg2 text-[13px] mb-3 max-w-[70ch]">
          Came back before this window closed and no walk-around was filed. Still open to check
          in — after that they drop off here too.
        </p>
        <div className="space-y-1.5">
          {sorted.map((r) => (
            <div key={`${r.assignmentId}-tail`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-lt-hairline rounded-lg px-3 py-2.5 bg-lt-page">
              <Car size={16} aria-hidden className="text-lt-fg3 flex-none" />
              <div className="min-w-0 flex-1">
                <div className="text-lt-fg text-[16px] font-semibold truncate">
                  {r.unitName}
                  <span className="text-lt-fg3 font-normal text-[13px] ml-2">{r.category}</span>
                </div>
                <div className="text-lt-fg2 text-[13px] truncate">
                  Due back {dayLabel(r.edgeDate, today)}
                  <span className="text-lt-fg3"> · {r.jobName} · {r.company}</span>
                </div>
              </div>
              <Link
                href={`/fleet/return/${r.assignmentId}`}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-md px-2.5 py-1.5 border border-lt-hairline text-lt-fg2 hover:bg-lt-inner flex-none"
              >
                Check in
                <ArrowRight size={13} aria-hidden />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </details>
  )
}

function VehicleRow({ row, edge }: { row: FleetMovement; edge: 'out' | 'back' }) {
  // The state that matters is the report for THIS end of the arc. A
  // truck due back whose checkout was never filed is still "not checked
  // in" — the missing checkout is the other lane's problem, and saying
  // so here would give this row two answers.
  const done = edge === 'out' ? !!row.inspection : !!row.returnInspection
  const stamp = edge === 'out' ? row.inspection : row.returnInspection
  const time = edge === 'out' ? row.deliveryTime : row.pickupTime

  return (
    <div className="border border-lt-hairline rounded-lg px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-lt-card">
      <Car size={16} aria-hidden className="text-lt-fg3 flex-none" />
      <div className="min-w-0 flex-1">
        <div className="text-lt-fg text-[16px] font-semibold truncate">
          {row.unitName}
          <span className="text-lt-fg3 font-normal text-[13px] ml-2">{row.category}</span>
        </div>
        <div className="text-lt-fg2 text-[13px] truncate">
          {row.jobName}
          <span className="text-lt-fg3"> · {row.company}</span>
          {time && <span className="text-lt-fg3"> · {time}</span>}
        </div>
        {/* Which order this truck is going out on, when sales has said
            so (Hugo, 2026-09-03). Extra information, never a blocker —
            an unattached unit still checks out normally. */}
        {row.attachedOrder && (
          <Link
            href={`/orders/${row.attachedOrder.id}`}
            className="inline-flex items-center gap-1 mt-1 text-[12px] font-semibold text-violet-800 border border-violet-200 bg-violet-50 rounded px-1.5 py-0.5 hover:bg-violet-100"
          >
            Order attached · {row.attachedOrder.orderNumber}
          </Link>
        )}
        {/* Blind pickup on the going-out lane, blind return on the coming-
            back lane — the handoff THIS end of the arc is about. Violet
            when set, same as the bar on the reservations board. */}
        <VehicleBlindToggle orders={row.liveOrders} kind={edge === 'out' ? 'blindPickup' : 'blindReturn'} />
      </div>

      {done ? (
        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-chip-good-fg border border-chip-good-fg/25 bg-chip-good-bg rounded-md px-2 py-1">
          <Check size={12} aria-hidden />
          {edge === 'out' ? 'Checked out' : 'Checked in'}
          {stamp?.inspectorName && <span className="font-normal opacity-80">· {stamp.inspectorName}</span>}
        </span>
      ) : (
        <span className="text-[12px] font-semibold text-chip-warn-fg border border-chip-warn-fg/25 bg-chip-warn-bg rounded-md px-2 py-1">
          Report due
        </span>
      )}

      <div className="flex items-center gap-1.5 flex-none">
        {edge === 'out' ? (
          <>
            {/* Once a walk-around is filed, "view" means the read-only
                record of what was captured — the capture screen only
                says it is done and shows none of it. */}
            <Link
              href={done && stamp ? `/reports/vehicles/${stamp.id}` : `/fleet/inspection/${row.assignmentId}`}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-md px-2.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white"
            >
              <ClipboardList size={13} aria-hidden />
              {done ? 'View report' : 'Check out'}
            </Link>
            {/* The keys move on a different screen from the condition
                report, and on a different person's schedule — the driver
                turns up when they turn up. Both live on the row. */}
            <Link
              href={`/fleet/pickup/${row.assignmentId}`}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-md px-2.5 py-1.5 border border-lt-hairline text-lt-fg2 hover:bg-lt-inner"
            >
              <KeyRound size={13} aria-hidden />
              Handover
            </Link>
          </>
        ) : (
          <Link
            href={done && stamp ? `/reports/vehicles/${stamp.id}` : `/fleet/return/${row.assignmentId}`}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-md px-2.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white"
          >
            {done ? 'View report' : 'Check in'}
            <ArrowRight size={13} aria-hidden />
          </Link>
        )}
      </div>
    </div>
  )
}
