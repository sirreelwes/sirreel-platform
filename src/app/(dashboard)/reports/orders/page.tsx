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

function fmtDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

function dayLabel(ymd: string, today: string): string {
  if (!ymd) return 'No dates'
  if (ymd === today) return `Today · ${fmtDay(ymd)}`
  if (ymd === pacificYmd(1)) return `Tomorrow · ${fmtDay(ymd)}`
  return fmtDay(ymd)
}

/**
 * Wes, 2026-09-11: "this list should start with today and as the most
 * visible." The query returns the window oldest-first, which put three
 * days of un-entered backlog above the sheets the floor is handing in
 * right now. Order the days: today, then what's coming, then the
 * backlog — most recent first, since that is the one most likely to
 * still be on someone's desk. Undated rows trail everything.
 */
function orderDays(days: string[], today: string): string[] {
  const dated = days.filter(Boolean)
  const upcoming = dated.filter((d) => d > today).sort()
  const earlier = dated.filter((d) => d < today).sort().reverse()
  const undated = days.includes('') ? [''] : []
  return [today, ...upcoming, ...earlier, ...undated]
}

export default async function OrderReportsPage() {
  const user = await getYardUser()
  if (!user) {
    return (
      <div className="max-w-sm mx-auto text-center py-16 px-6">
        <Lock size={32} aria-hidden className="mx-auto mb-3 text-lt-fg3" />
        <h1 className="text-lt-fg text-xl font-semibold mb-2">Yard access required</h1>
        <p className="text-lt-fg2 text-[15px]">
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
        <div className="text-amber-600 text-[13px] font-semibold uppercase tracking-wide mb-1">Orders</div>
        <h1 className="text-lt-fg text-2xl font-bold">Check In/Out Reports</h1>
        <p className="text-lt-fg2 text-[15px] mt-0.5 max-w-[70ch]">
          Type in the pull sheet after it comes off the floor. Everything is pre-filled with what
          the order says, so you only touch the lines that came out different — and on a check-out
          those differences update the order and tell the agent. Orders still in quote form are
          here too; they usually don&rsquo;t get flipped until after everything is back.
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
      <h2 className="text-lt-fg text-[15px] font-semibold uppercase tracking-wide mb-2">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-lt-fg2 text-[15px] border border-lt-hairline bg-lt-card rounded-lg px-4 py-6 text-center">{empty}</p>
      ) : (
        orderDays(days, today).map((ymd) => {
          const isToday = ymd === today
          const dayRows = rows.filter((r) => r.ymd === ymd)
          const firstEarlier = ymd && ymd < today && !days.some((d) => d && d < today && d > ymd)
          // Today always renders, even with nothing on it — it is the
          // anchor the eye lands on, and "nothing today" is itself the
          // answer the supervisor came for.
          if (dayRows.length === 0 && !isToday) return null
          return (
          <div key={ymd || 'undated'} className={isToday ? 'mb-6' : 'mb-4'}>
            {firstEarlier && (
              <div className="text-lt-fg3 text-[11px] font-semibold uppercase tracking-[0.16em] border-t border-lt-hairline pt-3 mt-2 mb-2">
                Earlier · still open
              </div>
            )}
            <div className={isToday
              ? 'text-amber-600 text-[15px] font-bold uppercase tracking-[0.12em] mb-2'
              : 'text-lt-fg3 text-[12px] font-bold uppercase tracking-[0.16em] mb-1.5'}>
              {dayLabel(ymd, today)}
            </div>
            {dayRows.length === 0 && (
              <p className="text-lt-fg2 text-[15px] border border-dashed border-lt-hairline bg-lt-card rounded-lg px-4 py-4 text-center">
                {edge === 'OUT' ? 'Nothing going out today.' : 'Nothing due back today.'}
              </p>
            )}
            <div className="space-y-1.5">
              {dayRows.map((r) => (
                <Link
                  key={r.orderId}
                  href={`/reports/orders/${r.orderId}?edge=${edge}`}
                  className={`border rounded-lg px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-lt-card hover:bg-lt-inner transition-colors ${
                    isToday
                      ? 'border-amber-600/40 border-l-4 border-l-amber-600 hover:border-amber-600'
                      : 'border-lt-hairline hover:border-lt-fg3'
                  }`}
                >
                  <ClipboardList size={16} aria-hidden className="text-lt-fg3 flex-none" />
                  <div className="min-w-0 flex-1">
                    <div className="text-lt-fg text-[16px] font-semibold truncate">
                      {r.jobName}
                      <span className="text-lt-fg3 font-mono font-normal text-[13px] ml-2">{r.orderNumber}</span>
                    </div>
                    <div className="text-lt-fg2 text-[13px] truncate">
                      {r.company}
                      <span className="text-lt-fg3"> · {r.lineCount} line{r.lineCount === 1 ? '' : 's'}</span>
                      {/* Wes, 2026-09-03: the paperwork on the truck is
                          routinely still a quote — the status catches up
                          days after the gear is back. Say so rather than
                          hiding the row, so the supervisor knows which
                          document they are writing against. */}
                      {r.preBooked && (
                        <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-wider text-pill-quoted-fg border border-pill-quoted-fg/25 bg-pill-quoted-bg rounded px-1.5 py-0.5">
                          Quote
                        </span>
                      )}
                    </div>
                  </div>

                  {r.filed ? (
                    /* A partial sheet is NOT a filed sheet — the rest of
                       the order still has to move, and this row is where
                       the supervisor comes back to finish it. */
                    r.filed.partial ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-pill-quoted-fg border border-pill-quoted-fg/25 bg-pill-quoted-bg rounded-md px-2 py-1">
                        Partial · {r.filed.offSheet} left
                      </span>
                    ) : r.filed.changedOrder ? (
                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-chip-warn-fg border border-chip-warn-fg/30 bg-chip-warn-bg rounded-md px-2 py-1">
                        <AlertTriangle size={12} aria-hidden />
                        Filed · order changed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-chip-good-fg border border-chip-good-fg/30 bg-chip-good-bg rounded-md px-2 py-1">
                        <Check size={12} aria-hidden />
                        Filed
                        {r.filed.preppedBy && <span className="text-chip-good-fg/70 font-normal">· {r.filed.preppedBy}</span>}
                      </span>
                    )
                  ) : (
                    <span className="text-[12px] font-semibold text-chip-warn-fg border border-chip-warn-fg/30 bg-chip-warn-bg rounded-md px-2 py-1">
                      Not entered
                    </span>
                  )}

                  <ArrowRight size={14} aria-hidden className="text-lt-fg3 flex-none" />
                </Link>
              ))}
            </div>
          </div>
          )
        })
      )}
    </section>
  )
}
