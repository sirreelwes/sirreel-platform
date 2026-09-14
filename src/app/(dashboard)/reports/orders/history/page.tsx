/**
 * /reports/orders/history — every sheet that has been filed.
 *
 * Oliver, 2026-09-14 (via Wes): "the fleet needs to be able to look at
 * past check-in and check-out sheets."
 *
 * /reports/orders is a work queue seven days wide; a sheet drops off it
 * once the week moves on. This is the record — what left the yard and
 * what came back, newest first, searchable by order, job, company or the
 * name of whoever prepped it. Rows open the READ-ONLY view of what was
 * filed, not the typing screen: looking something up must not be one
 * mis-tap away from re-filing a report that rewrites an order.
 */

import Link from 'next/link'
import { Lock, ArrowLeft, Camera, ArrowRight } from 'lucide-react'
import { getYardUser } from '@/lib/yard/requireYardAccess'
import { listFiledReports, type FiledReportRow } from '@/lib/orders/checkReports'

export const dynamic = 'force-dynamic'

function fmtWhen(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  }).format(d)
}

/** The Pacific day a sheet was filed — the heading rows group on it. */
function pacificDay(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles',
  }).format(d)
}

export default async function FiledReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const user = await getYardUser()
  if (!user) {
    return (
      <div className="max-w-sm mx-auto text-center py-16 px-6">
        <Lock size={32} aria-hidden className="mx-auto mb-3 text-lt-fg3" />
        <h1 className="text-lt-fg text-xl font-semibold mb-2">Yard access required</h1>
        <p className="text-lt-fg2 text-[15px]">
          Check in/out sheets are for fleet and warehouse staff. Ask Wes or Hugo if you need it.
        </p>
      </div>
    )
  }

  const { q } = await searchParams
  const rows = await listFiledReports({ q })
  const days = [...new Set(rows.map((r) => pacificDay(r.submittedAt)))]

  return (
    <div className="max-w-4xl mx-auto px-1 py-2">
      <header className="mb-5">
        <Link
          href="/reports/orders"
          className="inline-flex items-center gap-1.5 text-[13px] text-lt-fg2 hover:text-lt-fg mb-2"
        >
          <ArrowLeft size={14} aria-hidden /> Check In/Out Reports
        </Link>
        <h1 className="text-lt-fg text-2xl font-bold">Past sheets</h1>
        <p className="text-lt-fg2 text-[15px] mt-0.5 max-w-[70ch]">
          Every check-out and check-in that has been filed, newest first. Opening one shows what
          was counted — it does not re-open the sheet for typing.
        </p>
      </header>

      {/* A plain GET form: no client state, and the search survives a
          refresh or a link somebody pastes into Slack. */}
      <form method="GET" className="mb-5 flex items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Order number, job, company, or who prepped it"
          className="flex-1 bg-lt-card border border-lt-hairline rounded-lg px-3 py-2 text-[15px] text-lt-fg placeholder:text-lt-fg3"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-[15px] font-semibold rounded-lg"
        >
          Search
        </button>
        {q ? (
          <Link href="/reports/orders/history" className="text-[14px] text-lt-fg2 hover:text-lt-fg px-2">
            Clear
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="border border-lt-hairline bg-lt-card rounded-xl px-4 py-8 text-center text-[15px] text-lt-fg3">
          {q ? `Nothing filed matches “${q}”.` : 'No sheets have been filed yet.'}
        </p>
      ) : (
        days.map((day) => (
          <section key={day} className="mb-6">
            <h2 className="text-lt-fg2 text-[13px] font-semibold uppercase tracking-wide mb-2">{day}</h2>
            <div className="border border-lt-hairline bg-lt-card rounded-xl overflow-hidden">
              {rows
                .filter((r) => pacificDay(r.submittedAt) === day)
                .map((r) => (
                  <Row key={`${r.orderId}-${r.edge}`} row={r} />
                ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

function Row({ row }: { row: FiledReportRow }) {
  return (
    <Link
      href={`/reports/orders/${row.orderId}/filed?edge=${row.edge}`}
      className="flex items-center gap-3 px-3 py-2.5 border-b border-lt-hairline last:border-b-0 hover:bg-lt-inner"
    >
      <span
        className={`flex-none text-[11px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 border ${
          row.edge === 'OUT'
            ? 'text-chip-warn-fg border-chip-warn-fg/30 bg-chip-warn-bg'
            : 'text-chip-good-fg border-chip-good-fg/30 bg-chip-good-bg'
        }`}
      >
        {row.edge === 'OUT' ? 'Out' : 'In'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-lt-fg text-[16px] font-medium truncate">
          {row.jobName} <span className="text-lt-fg3 font-normal">· {row.company}</span>
        </div>
        <div className="text-lt-fg2 text-[13px] truncate">
          <span className="font-mono">{row.orderNumber}</span> · {fmtWhen(row.submittedAt)}
          {row.preppedBy ? ` · prepped by ${row.preppedBy}` : ''}
          {row.submittedByName ? ` · typed in by ${row.submittedByName}` : ''}
        </div>
      </div>
      <div className="flex-none flex items-center gap-1.5">
        {row.hasPhoto && (
          <span title="Photo of the paper" className="text-lt-fg3 flex items-center">
            <Camera size={14} aria-hidden />
          </span>
        )}
        {row.partial && (
          <span className="text-[11px] font-semibold rounded px-1.5 py-0.5 border text-pill-quoted-fg border-pill-quoted-fg/25 bg-pill-quoted-bg">
            Partial
          </span>
        )}
        <span className="text-[13px] text-lt-fg3 whitespace-nowrap">
          {row.differed > 0 ? `${row.differed} differed` : `${row.lineCount} as ordered`}
        </span>
        <ArrowRight size={15} aria-hidden className="text-lt-fg3" />
      </div>
    </Link>
  )
}
