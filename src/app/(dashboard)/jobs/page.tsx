'use client'

/**
 * /jobs with nothing selected — the ONE STOP SHOP landing (Wes
 * 2026-08-27: "combine the jobs and inquiries pages … incoming, active
 * and wrapped").
 *
 * The whole lifecycle reads across one screen:
 *   INCOMING — this panel: the live inbound queue (web forms + Gmail
 *              suggestions), the one sent-quotes list with the nudge,
 *              upcoming reservations, and the signals strip. This is
 *              the former /inquiries workspace re-homed, not rebuilt —
 *              /inquiries now redirects here.
 *   ACTIVE  — the sidebar: every job, colored by cycle position,
 *              readiness as the second axis.
 *   WRAPPED — the same sidebar, bottom of the urgency sort (Returned /
 *              Cancelled / Lost), with the status dropdown to narrow.
 *
 * The "Today" strip stays from the old landing — it is the operational
 * bridge between incoming and active. The old "book by state" tiles are
 * gone: the sidebar's legend chips already carry the same counts and
 * the same one-click narrowing, and this page does not repeat the list.
 *
 * Won work converting out of the queue lands as a Job in the left rail
 * — the point of the merge is that it never leaves the page.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useJobsList } from '@/components/jobs/JobsListProvider'
import { ActionItemsPanel } from '@/components/actionItems/ActionItemsPanel'
import { NewInboundColumn } from '@/components/sales/NewInboundColumn'
import { QuotesOutPanel } from '@/components/sales/QuotesOutPanel'
import { SalesReservationsWidget } from '@/components/sales/SalesReservationsWidget'
import { SalesSignalsStrip } from '@/components/sales/SalesSignalsStrip'
import { CopyIntakeLinkButton } from '@/components/intake/CopyIntakeLinkButton'
import { STATE, fmtDate, jobWindow, stateLabel, type JobRow, type RowState } from '@/lib/jobs/listRow'

// What physically MOVES today, split by direction (Wes 2026-08-28:
// "break it up into Coming back and Going out sections" — mirrors the
// Reservations Out/Back strip's vocabulary). Overdue is deliberately
// not listed row by row — the Planyo-era backlog is 60+ jobs and
// buried the inbound queue under it; it collapses to one summary line
// inside Coming back (that's the direction it belongs to).
const GOING_OUT_STATE: RowState = 'picking-today'
const COMING_BACK_STATE: RowState = 'returning-today'

export default function JobsLandingPage() {
  const { data: session, status: authStatus } = useSession()
  const role = (session?.user as { role?: string } | undefined)?.role

  // AGENT defaults to My Deals; everyone else to Team — carried over
  // from the inquiries workspace unchanged.
  const [scope, setScope] = useState<'my' | 'team'>('team')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (authStatus !== 'authenticated') return
    setScope(role === 'AGENT' ? 'my' : 'team')
  }, [authStatus, role])

  const refreshAll = () => setRefreshKey((k) => k + 1)

  const { allRows, counts, setStateFilter, refresh: refreshJobs } = useJobsList()
  const goingOutRows = allRows.filter((r) => r.state === GOING_OUT_STATE)
  const comingBackRows = allRows.filter((r) => r.state === COMING_BACK_STATE)
  const overdueCount = counts.get('overdue') ?? 0

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* The page title lives in the JobsToolbar (the full-width bar the
          layout renders above the split — Wes 2026-08-28); this header is
          just the landing-panel-specific controls. */}
      <header className="flex items-center justify-end gap-2 flex-wrap">
        <CopyIntakeLinkButton />
        <div className="flex rounded-lg border border-zinc-200 overflow-hidden text-[12px] font-semibold">
          <button
            onClick={() => setScope('my')}
            className={scope === 'my' ? 'px-3 py-1.5 bg-zinc-900 text-white' : 'px-3 py-1.5 bg-white text-zinc-500 hover:bg-zinc-50'}
          >
            My Deals
          </button>
          <button
            onClick={() => setScope('team')}
            className={scope === 'team' ? 'px-3 py-1.5 bg-zinc-900 text-white' : 'px-3 py-1.5 bg-white text-zinc-500 hover:bg-zinc-50'}
          >
            Team View
          </button>
        </div>
      </header>

      {/* What physically moves today, split by direction — the bridge
          between incoming and active. Same vocabulary as the
          Reservations Out/Back strip. Empty is a real answer here,
          and a good one. */}
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <section className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-zinc-100 flex items-baseline gap-2">
            <h2 className="text-[13px] font-bold uppercase tracking-wider text-amber-700">Going out</h2>
            <span className="text-[11px] text-zinc-400">today</span>
            <span className="ml-auto text-[11px] text-zinc-400">{goingOutRows.length}</span>
          </div>
          {goingOutRows.length === 0 ? (
            <div className="px-4 py-4 text-center text-[12px] text-zinc-400">
              Nothing going out today.
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {goingOutRows.map(({ job, state }) => (
                <TodayRow key={job.id} job={job} state={state} />
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-zinc-100 flex items-baseline gap-2">
            <h2 className="text-[13px] font-bold uppercase tracking-wider text-emerald-700">Coming back</h2>
            <span className="text-[11px] text-zinc-400">today</span>
            <span className="ml-auto text-[11px] text-zinc-400">{comingBackRows.length}</span>
          </div>
          {/* The not-returned backlog as ONE line, not 60 rows — it must
              not bury the inbound queue below it. Click filters the rail.
              Lives here because a missed return IS a coming-back problem. */}
          {overdueCount > 0 && (
            <button
              onClick={() => setStateFilter('overdue')}
              className="w-full flex items-center gap-3 px-4 py-2 border-b border-zinc-100 hover:bg-red-50 transition-colors text-left"
            >
              <span className="w-1.5 h-8 rounded-sm flex-shrink-0 bg-red-500" />
              <span className="text-[13px] font-medium text-zinc-900">
                {overdueCount} not returned
              </span>
              <span className="text-[11px] text-zinc-500">nobody confirmed the gear came back</span>
              <span className="ml-auto text-[11px] font-semibold text-red-600">show in the rail →</span>
            </button>
          )}
          {comingBackRows.length === 0 ? (
            <div className="px-4 py-4 text-center text-[12px] text-zinc-400">
              Nothing due back today.
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {comingBackRows.map(({ job, state }) => (
                <TodayRow key={job.id} job={job} state={state} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Action items — the cross-role "needs a human" registry, folded in
          from /action-items (Wes 2026-08-27). Omits itself when empty. */}
      <ActionItemsPanel />

      {/* Two-column workspace (Wes, 2026-08-22 — layout ruling carried
          over from /inquiries): NEW INBOUND lives in the RIGHT column;
          Quotes out + Upcoming reservations stack in the LEFT column.
          DOM order keeps the live inbound queue FIRST so single-column
          still leads with it; lg:order-* swaps the visual sides.
          onChange also refreshes the jobs list — a conversion should
          appear in the left rail without a reload. */}
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <div className="lg:order-2">
          <NewInboundColumn onChange={() => { refreshAll(); refreshJobs(); }} />
        </div>
        <div className="lg:order-1 space-y-4">
          <QuotesOutPanel scope={scope} refreshKey={refreshKey} />
          <div className="bg-white border border-zinc-200 rounded-xl p-4">
            <SalesReservationsWidget />
          </div>
        </div>
      </div>

      {/* Signals — stale quotes / pending COIs / dormant clients */}
      <SalesSignalsStrip scope={scope} onChange={refreshAll} />
    </div>
  )
}

// One movement row — shared by the Going out and Coming back sections.
function TodayRow({ job, state }: { job: JobRow; state: RowState }) {
  const w = jobWindow(job)
  return (
    <Link
      href={`/jobs/${job.id}`}
      className="flex items-center gap-3 px-4 py-2 hover:bg-zinc-50 transition-colors"
    >
      <span className={`w-1.5 h-8 rounded-sm flex-shrink-0 ${STATE[state].rail}`} />
      <span className="text-[11px] font-mono font-bold text-zinc-500 w-12 flex-shrink-0">
        {job.jobCode.replace(/^SR-JOB-/, '')}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-zinc-900 truncate">{job.name}</span>
        <span className="block text-[11px] text-zinc-500 truncate">
          {job.company?.name || 'no company'}
          {' · '}
          {fmtDate(w.start)} → {fmtDate(w.end)}
        </span>
      </span>
      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 whitespace-nowrap">
        {stateLabel(job, state)}
      </span>
    </Link>
  )
}
