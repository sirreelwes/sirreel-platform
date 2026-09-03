/**
 * /reports/orders — Check In/Out Reports.
 *
 * Hugo, 2026-09-03: "the warehouse prefers to have pick lists handled
 * manually on paper. Once the warehouse associate finishes prepping and
 * loading they take the paperwork to Albert, Carlos, Hugo or Pedro for
 * them to do the Check In/Out Reports. This needs to be a tab on the
 * left and essentially that digitizes the report."
 *
 * This is the tab: the day's orders, going out and coming back, each
 * saying whether its sheet has been typed in yet. Opening one is the
 * transcription screen.
 *
 * Note what it is NOT: /warehouse/pick is still there and untouched, and
 * is still the scan-driven session for anyone who wants it. The floor
 * has chosen paper; this surface takes them at their word rather than
 * trying to talk them back onto the scanner.
 */

import Link from 'next/link'
import { Lock, ClipboardList, Check, AlertTriangle, ArrowRight } from 'lucide-react'
import { getYardUser } from '@/lib/yard/requireYardAccess'
import { pacificYmd } from '@/lib/fleet/todayBoard'
import { reportListFor, type ReportListRow } from '@/lib/orders/checkReports'

export const dynamic = 'force-dynamic'

function dayLabel(ymd: string, today: string): string {
  if (!ymd) return 'No dates'
  if (ymd === today) return 'Today'
  const [y, m, d] = ymd.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

export default async function OrderReportsPage() {
  const user = await getYardUser()
  if (!user) {
    return (
      <div className="max-w-sm mx-auto text-center py-16 px-6">
        <Lock size={32} aria-hidden className="mx-auto mb-3 text-zinc-500" />
        <h1 className="text-white text-lg font-semibold mb-2">Yard access required</h1>
        <p className="text-zinc-400 text-sm">
          Check in/out reports are for fleet and warehouse staff. Ask Wes or Hugo if you need it.
        </p>
      </div>
    )
  }

  const today = pacificYmd(0)
  const [out, back] = await Promise.all([reportListFor('OUT'), reportListFor('IN')])

  return (
    <div className="max-w-4xl mx-auto px-1 py-2">
      <header className="mb-5">
        <div className="text-amber-500 text-xs font-semibold uppercase tracking-wide mb-1">Orders</div>
        <h1 className="text-white text-2xl font-bold">Check In/Out Reports</h1>
        <p className="text-zinc-500 text-sm mt-0.5 max-w-[70ch]">
          Type in the pull sheet after it comes off the floor. Everything is pre-filled with what
          the order says, so you only touch the lines that came out different — and on a check-out
          those differences update the order and tell the agent.
        </p>
      </header>

      <Lane
        title="Check out — going out"
        empty="No booked orders going out in this window."
        rows={out}
        today={today}
        edge="OUT"
      />
      <Lane
        title="Check in — coming back"
        empty="No orders due back in this window."
        rows={back}
        today={today}
        edge="IN"
      />
    </div>
  )
}

function Lane({
  title, empty, rows, today, edge,
}: {
  title: string
  empty: string
  rows: ReportListRow[]
  today: string
  edge: 'OUT' | 'IN'
}) {
  const days = [...new Set(rows.map((r) => r.ymd))]

  return (
    <section className="mb-8">
      <h2 className="text-white text-sm font-semibold uppercase tracking-wide mb-2">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-zinc-500 text-sm border border-zinc-800 rounded-lg px-4 py-6 text-center">{empty}</p>
      ) : (
        days.map((ymd) => (
          <div key={ymd} className="mb-4">
            <div className={`text-[11px] font-bold uppercase tracking-[0.16em] mb-1.5 ${
              ymd === today ? 'text-amber-500' : 'text-zinc-500'
            }`}>
              {dayLabel(ymd, today)}
            </div>
            <div className="space-y-1.5">
              {rows.filter((r) => r.ymd === ymd).map((r) => (
                <Link
                  key={r.orderId}
                  href={`/reports/orders/${r.orderId}?edge=${edge}`}
                  className="border border-zinc-800 rounded-lg px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-zinc-900/40 hover:bg-zinc-900 hover:border-zinc-700 transition-colors"
                >
                  <ClipboardList size={16} aria-hidden className="text-zinc-500 flex-none" />
                  <div className="min-w-0 flex-1">
                    <div className="text-white text-[14px] font-semibold truncate">
                      {r.jobName}
                      <span className="text-zinc-500 font-mono font-normal text-[12px] ml-2">{r.orderNumber}</span>
                    </div>
                    <div className="text-zinc-400 text-[12px] truncate">
                      {r.company}
                      <span className="text-zinc-600"> · {r.lineCount} line{r.lineCount === 1 ? '' : 's'}</span>
                    </div>
                  </div>

                  {r.filed ? (
                    r.filed.changedOrder ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300 border border-amber-900 bg-amber-950/50 rounded-md px-2 py-1">
                        <AlertTriangle size={12} aria-hidden />
                        Filed · order changed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 border border-emerald-900 bg-emerald-950/50 rounded-md px-2 py-1">
                        <Check size={12} aria-hidden />
                        Filed
                        {r.filed.preppedBy && <span className="text-emerald-600 font-normal">· {r.filed.preppedBy}</span>}
                      </span>
                    )
                  ) : (
                    <span className="text-[11px] font-semibold text-amber-300 border border-amber-900 bg-amber-950/50 rounded-md px-2 py-1">
                      Not entered
                    </span>
                  )}

                  <ArrowRight size={14} aria-hidden className="text-zinc-600 flex-none" />
                </Link>
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  )
}
