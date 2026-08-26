'use client'

/**
 * /jobs with nothing selected — the right panel's landing.
 *
 * The list itself is the sidebar (see the layout), so this panel does
 * NOT repeat it. It answers the two questions you have before you've
 * picked a job: what's the shape of the book right now, and what
 * needs a human today. Everything here narrows or opens the list on
 * the left rather than duplicating it.
 */

import Link from 'next/link'
import { useJobsList } from '@/components/jobs/JobsListProvider'
import {
  STATE,
  URGENCY,
  fmtDate,
  fmtMoney,
  jobWindow,
  rowValue,
  stateLabel,
  type RowState,
} from '@/lib/jobs/listRow'

// The states that mean "somebody has to do something today". Anything
// else can wait for the scan.
const TODAY_STATES: RowState[] = ['overdue', 'returning-today', 'picking-today']

export default function JobsLandingPage() {
  const { allRows, counts, loading, error, setStateFilter, stateFilter } = useJobsList()

  const present = URGENCY.filter((s) => (counts.get(s) ?? 0) > 0)
  const todayRows = allRows.filter((r) => TODAY_STATES.includes(r.state))
  const totalValue = allRows.reduce((sum, r) => sum + (rowValue(r.job) ?? 0), 0)

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-900">Jobs</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Pick a job on the left to open it. Color is where the job sits in the cycle — the list is
          sorted most-urgent first. Create with the &ldquo;+ New Job&rdquo; button above.
        </p>
      </header>

      {loading && allRows.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-xl px-4 py-10 text-center text-zinc-400 text-sm">
          Loading…
        </div>
      ) : error ? (
        <div className="bg-white border border-red-200 rounded-xl px-4 py-10 text-center text-red-600 text-sm">
          {error}
        </div>
      ) : (
        <>
          {/* Needs a human today. Empty is a real answer here, and a
              good one — say so rather than rendering an empty box. */}
          <section className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-zinc-100 flex items-baseline gap-2">
              <h2 className="text-[13px] font-bold uppercase tracking-wider text-zinc-800">Today</h2>
              <span className="text-[11px] text-zinc-400">
                overdue, back today, out today
              </span>
              <span className="ml-auto text-[11px] text-zinc-400">{todayRows.length}</span>
            </div>
            {todayRows.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12px] text-zinc-400">
                Nothing due back or going out today, and nothing overdue.
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {todayRows.map(({ job, state }) => {
                  const w = jobWindow(job)
                  return (
                    <Link
                      key={job.id}
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
                })}
              </div>
            )}
          </section>

          {/* The book, by state. Each tile narrows the list on the
              left — that's the whole point of putting them here. */}
          <section className="bg-white border border-zinc-200 rounded-xl p-4">
            <div className="flex items-baseline gap-2 mb-3">
              <h2 className="text-[13px] font-bold uppercase tracking-wider text-zinc-800">The book</h2>
              <span className="text-[11px] text-zinc-400">click a state to narrow the list</span>
              <span className="ml-auto text-[11px] text-zinc-500">
                {allRows.length} jobs · {fmtMoney(totalValue)}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {present.map((s) => {
                const on = stateFilter === s
                return (
                  <button
                    key={s}
                    onClick={() => setStateFilter(on ? null : s)}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-colors ${
                      on ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200 hover:border-zinc-400'
                    }`}
                  >
                    <span className={`w-1.5 h-7 rounded-sm flex-shrink-0 ${STATE[s].rail}`} />
                    <span className="min-w-0">
                      <span className="block text-[11px] text-zinc-500 leading-tight truncate">
                        {STATE[s].label}
                      </span>
                      <span className="block text-[16px] font-semibold text-zinc-900 leading-tight tabular-nums">
                        {counts.get(s)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
            {stateFilter && (
              <button
                onClick={() => setStateFilter(null)}
                className="mt-3 text-[11px] text-zinc-500 underline underline-offset-2 hover:text-zinc-900"
              >
                Clear filter — show all {allRows.length} jobs
              </button>
            )}
          </section>
        </>
      )}
    </div>
  )
}
