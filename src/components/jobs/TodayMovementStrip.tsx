'use client'

/**
 * What physically moves today, split by direction — Going out / Coming
 * back. Wes, 2026-08-31: move it off the /jobs landing and onto /orders.
 *
 * ── Why it fetches its own rows ────────────────────────────────────
 *
 * On /jobs this read `useJobsList()`, the context the jobs LAYOUT
 * provides. /orders has no such layout, and `useJobsList` throws outside
 * its provider — so wrapping the orders page in JobsListProvider would
 * have meant mounting the whole filter/sort/search machine of a list
 * that isn't on the page, just to borrow its fetch.
 *
 * One call to /api/jobs and the shared `rowState()` derivation gives the
 * same rows with none of that. The derivation stays in
 * src/lib/jobs/listRow so this strip and the rail cannot disagree about
 * what "going out today" means.
 *
 * ── The overdue line ───────────────────────────────────────────────
 *
 * On /jobs the "N not returned" line filtered the rail in place. There
 * is no rail here, so it navigates to /jobs?state=overdue instead — the
 * click has to land somewhere real, and a button that silently does
 * nothing is worse than no button.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  STATE, listDays, rowState, stateLabel,
  type JobRow, type RowState,
} from '@/lib/jobs/listRow'

const GOING_OUT_STATE: RowState = 'picking-today'
const COMING_BACK_STATE: RowState = 'returning-today'

export function TodayMovementStrip() {
  const [jobs, setJobs] = useState<JobRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/jobs')
      .then((r) => r.json())
      .then((d) => { if (!cancelled && !d.error) setJobs(d.jobs || []) })
      // A failed read hides the strip. It is a bridge to today's
      // movements, not the reason anyone opened the orders list.
      .catch(() => { if (!cancelled) setJobs([]) })
    return () => { cancelled = true }
  }, [])

  if (jobs === null) return null

  const { today, tomorrow } = listDays()
  const rows = jobs.map((job) => ({ job, state: rowState(job, today, tomorrow) }))
  const goingOut = rows.filter((r) => r.state === GOING_OUT_STATE)
  const comingBack = rows.filter((r) => r.state === COMING_BACK_STATE)
  const overdueCount = rows.filter((r) => r.state === 'overdue').length

  return (
    <div className="grid gap-4 lg:grid-cols-2 items-start">
      <section className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-lt-hairline flex items-baseline gap-2">
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-amber-700">Going out</h2>
          <span className="text-[11px] text-lt-fg3">today</span>
          <span className="ml-auto text-[11px] text-lt-fg3">{goingOut.length}</span>
        </div>
        {goingOut.length === 0 ? (
          <div className="px-4 py-4 text-center text-[12px] text-lt-fg3">Nothing going out today.</div>
        ) : (
          <div className="divide-y divide-lt-hairline">
            {goingOut.map(({ job, state }) => <TodayRow key={job.id} job={job} state={state} />)}
          </div>
        )}
      </section>

      <section className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-lt-hairline flex items-baseline gap-2">
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-emerald-700">Coming back</h2>
          <span className="text-[11px] text-lt-fg3">today</span>
          <span className="ml-auto text-[11px] text-lt-fg3">{comingBack.length}</span>
        </div>
        {/* The not-returned backlog as ONE line, not 60 rows. Lives here
            because a missed return IS a coming-back problem. */}
        {overdueCount > 0 && (
          <Link
            href="/jobs?state=overdue"
            className="w-full flex items-center gap-3 px-4 py-2 border-b border-lt-hairline hover:bg-red-50 transition-colors text-left"
          >
            <span className="w-1.5 h-8 rounded-sm flex-shrink-0 bg-red-500" />
            <span className="text-[13px] font-medium text-lt-fg">{overdueCount} not returned</span>
            <span className="text-[11px] text-lt-fg2">nobody confirmed the gear came back</span>
            <span className="ml-auto text-[11px] font-semibold text-red-600">show in Jobs →</span>
          </Link>
        )}
        {comingBack.length === 0 ? (
          <div className="px-4 py-4 text-center text-[12px] text-lt-fg3">Nothing due back today.</div>
        ) : (
          <div className="divide-y divide-lt-hairline">
            {comingBack.map(({ job, state }) => <TodayRow key={job.id} job={job} state={state} />)}
          </div>
        )}
      </section>
    </div>
  )
}

/** One movement row — shared by the Going out and Coming back sections. */
function TodayRow({ job, state }: { job: JobRow; state: RowState }) {
  return (
    <Link href={`/jobs/${job.id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-lt-inner transition-colors">
      <span className={`w-1.5 h-8 rounded-sm flex-shrink-0 ${STATE[state].rail}`} />
      <span className="text-[11px] font-mono font-bold text-lt-fg3 w-12 flex-shrink-0">
        {job.jobCode.replace(/^SR-JOB-/, '')}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-lt-fg truncate">{job.name}</span>
        <span className="block text-[11px] text-lt-fg2 truncate">
          {job.company?.name || 'no company'}
        </span>
      </span>
      <span className="text-[10px] font-bold uppercase tracking-wider text-lt-fg2 whitespace-nowrap">
        {stateLabel(job, state)}
      </span>
    </Link>
  )
}
