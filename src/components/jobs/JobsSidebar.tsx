'use client'

/**
 * The /jobs list — a dark, always-present index on the left, with the
 * selected job's detail in the panel to its right.
 *
 * It deliberately echoes the app's own nav: same `#1a1a1a` chrome,
 * same brand-gold selected row (black on gold), so "which job am I
 * in" reads exactly like "which page am I on". Cycle position is
 * carried by the saturated color rail on each item — no columns, no
 * pre/on/post grouping.
 *
 * Selection is the URL (`/jobs/[id]`), not local state: the layout
 * that owns this component persists across those navigations, so the
 * list keeps its scroll position, filter, and fetched rows while the
 * right panel swaps.
 */

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useJobsList, type Sort, type StatusFilter } from './JobsListProvider'
import {
  STATE,
  URGENCY,
  fmtDate,
  fmtMoney,
  jobWindow,
  rowValue,
  stateLabel,
  type JobRow,
  type RowState,
} from '@/lib/jobs/listRow'

const STATUS_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All jobs' },
  { id: 'NEW', label: 'New' },
  { id: 'QUOTED', label: 'Quoted' },
  // No 'Active' option: nothing ever wrote ACTIVE automatically, so it
  // filtered to "whoever remembered to flip the dropdown" rather than
  // to jobs that are actually running. The rail color answers that.
  { id: 'HOLD', label: 'Hold' },
  { id: 'WRAPPED', label: 'Wrapped' },
  { id: 'LOST', label: 'Lost' },
  { id: 'orphans', label: 'Orphaned quotes' },
]

const SORT_OPTIONS: { id: Sort; label: string }[] = [
  { id: 'urgency', label: 'Urgency' },
  { id: 'dates', label: 'Dates' },
  { id: 'value', label: 'Value' },
  { id: 'newest', label: 'Newest' },
]

export function JobsSidebar() {
  const {
    rows, counts, loading, error,
    search, setSearch,
    status, setStatus,
    mine, setMine,
    sort, setSort,
    stateFilter, setStateFilter,
  } = useJobsList()

  const pathname = usePathname()
  const selectedId = pathname?.startsWith('/jobs/') ? pathname.slice('/jobs/'.length).split('/')[0] : null
  // Below `md` the split can't hold both, so the list IS /jobs and
  // the detail IS /jobs/[id] — same URLs, one pane at a time.
  const selected = !!selectedId

  // Keep the selected job in view when it's reached from elsewhere
  // (a link, a reload) rather than by clicking it in this list.
  const [collapsed, setCollapsed] = useState(false)

  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selectedId) return
    const el = listRef.current?.querySelector(`[data-job-id="${selectedId}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, rows.length])

  // Only states actually present get a key entry — a legend full of
  // zeroes is noise.
  const keyStates = URGENCY.filter((s) => (counts.get(s) ?? 0) > 0)

  if (collapsed && selected) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="Show the job list"
        className="hidden md:flex w-8 flex-shrink-0 bg-[#0B0B0B] border-l border-r border-white/[0.06] flex-col items-center gap-2 pt-3 text-slate-400 hover:text-[#c9a24b]"
      >
        <span className="text-[13px] leading-none">›</span>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] [writing-mode:vertical-rl]">
          Jobs {rows.length}
        </span>
      </button>
    )
  }

  return (
    <aside
      className={`${
        selected ? 'hidden md:flex' : 'flex'
      } w-full md:w-[17rem] xl:w-[19rem] 2xl:w-[21rem] flex-shrink-0 bg-[#0B0B0B] text-slate-200 flex-col border-l border-white/[0.06] border-r border-white/[0.06]`}
    >
      <div className="px-3 pt-3 pb-2 space-y-2 border-b border-white/10">
        <div className="flex items-baseline gap-2">
          <h1 className="text-[13px] font-bold uppercase tracking-[0.18em] text-[#c9a24b]">Jobs</h1>
          <span className="text-[11px] text-slate-500">
            {loading ? 'loading…' : error ? 'error' : `${rows.length}${stateFilter ? ` of ${[...counts.values()].reduce((a, b) => a + b, 0)}` : ''}`}
          </span>
          <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={mine}
              onChange={(e) => setMine(e.target.checked)}
              className="accent-[#c9a24b]"
            />
            Mine
          </label>
          {selected && (
            <button
              onClick={() => setCollapsed(true)}
              title="Collapse the list — give the job detail the width"
              className="hidden md:block text-[13px] leading-none text-slate-500 hover:text-[#c9a24b] px-1"
            >
              ‹
            </button>
          )}
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search job, code, company, contact…"
          className="w-full px-2.5 py-1.5 bg-white/[0.06] border border-white/10 rounded-lg text-[12px] text-white placeholder:text-slate-500 focus:outline-none focus:border-[#c9a24b]/60"
        />

        <div className="flex items-center gap-1.5">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="flex-1 min-w-0 px-2 py-1 bg-white/[0.06] border border-white/10 rounded-md text-[11px] text-slate-200 focus:outline-none focus:border-[#c9a24b]/60"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.id} value={o.id} className="bg-[#1a1a1a]">
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            title="Sort order"
            className="px-2 py-1 bg-white/[0.06] border border-white/10 rounded-md text-[11px] text-slate-200 focus:outline-none focus:border-[#c9a24b]/60"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id} className="bg-[#1a1a1a]">
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Color key — the legend for the rails, and a one-click narrow. */}
        {keyStates.length > 0 && (
          <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
            {keyStates.map((s) => {
              const on = stateFilter === s
              return (
                <button
                  key={s}
                  onClick={() => setStateFilter(on ? null : s)}
                  title={`${STATE[s].label} — click to show only these`}
                  className={`flex items-center gap-1 text-[10px] rounded px-1 py-0.5 ${
                    on ? 'bg-[#c9a24b] text-[#1a1a1a] font-bold' : 'text-slate-400 hover:bg-white/[0.07]'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-sm ${STATE[s].rail}`} />
                  {STATE[s].short}
                  <span className={on ? 'font-bold' : 'text-slate-500'}>{counts.get(s)}</span>
                </button>
              )
            })}
            {stateFilter && (
              <button
                onClick={() => setStateFilter(null)}
                className="text-[10px] text-slate-500 underline underline-offset-2 hover:text-slate-300"
              >
                clear
              </button>
            )}
          </div>
        )}
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto py-1">
        {loading && rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-slate-500">Loading…</div>
        ) : error ? (
          <div className="px-3 py-6 text-center text-[11px] text-red-300">{error}</div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-slate-500">
            {status === 'orphans' ? 'No abandoned quotes. Good housekeeping.' : 'No jobs match.'}
          </div>
        ) : (
          rows.map(({ job, state }) => (
            <JobsSidebarItem key={job.id} job={job} state={state} selected={job.id === selectedId} />
          ))
        )}
      </div>
    </aside>
  )
}

function JobsSidebarItem({
  job: j,
  state,
  selected,
}: {
  job: JobRow
  state: RowState
  selected: boolean
}) {
  const meta = STATE[state]
  const w = jobWindow(j)
  const value = rowValue(j)

  // The pill keeps its hue in both selection states; only the plate
  // behind it changes, so a selected row stays readable on gold
  // without losing what state it's in. `overdue` gets the loud
  // treatment either way.
  const pillCls =
    state === 'overdue'
      ? 'bg-red-600 text-white'
      : selected
        ? `bg-[#1a1a1a] ${meta.fg}`
        : `bg-white/[0.07] ${meta.fg}`

  return (
    <Link
      href={`/jobs/${j.id}`}
      data-job-id={j.id}
      className="group flex items-stretch gap-0 px-2 py-[3px]"
    >
      {/* Rail sits OUTSIDE the selection fill so the state color
          survives the gold highlight. */}
      <span className={`w-1 rounded-l flex-shrink-0 ${meta.rail}`} aria-hidden="true" />
      <span
        className={`flex-1 min-w-0 rounded-r px-2 py-1.5 transition-colors ${
          selected ? 'bg-[#c9a24b] text-[#1a1a1a]' : 'bg-white/[0.05] group-hover:bg-white/[0.11]'
        }`}
      >
        <span className="flex items-center gap-1.5">
          <span
            className={`text-[10.5px] font-mono font-bold ${selected ? 'text-[#1a1a1a]/70' : 'text-slate-500'}`}
          >
            {j.jobCode.replace(/^SR-JOB-/, '')}
          </span>
          {j.hasLD && (
            <span className={selected ? 'text-red-800 text-[10px]' : 'text-red-400 text-[10px]'} title="Loss & Damage claim open">
              ▲
            </span>
          )}
          {j.hasDelivery && state !== 'back' && (
            <span
              className={`text-[8px] font-bold uppercase tracking-wider px-1 rounded ${
                selected ? 'bg-[#1a1a1a] text-amber-300' : 'bg-amber-500/90 text-[#1a1a1a]'
              }`}
              title="Delivery — a booking on this job has a delivery address"
            >
              Del
            </span>
          )}
          <span
            className={`ml-auto text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap ${pillCls}`}
          >
            {stateLabel(j, state, true)}
          </span>
        </span>

        <span
          className={`block text-[12.5px] font-semibold leading-tight truncate ${
            selected ? 'text-[#1a1a1a]' : 'text-slate-100'
          }`}
        >
          {j.name}
        </span>

        <span
          className={`flex items-baseline gap-1.5 text-[10.5px] leading-tight ${
            selected ? 'text-[#1a1a1a]/70' : 'text-slate-500'
          }`}
        >
          <span className="truncate">{j.company?.name || 'no company'}</span>
          <span className="ml-auto whitespace-nowrap tabular-nums">
            {w.start || w.end ? `${fmtDate(w.start)} → ${fmtDate(w.end)}` : 'no dates'}
          </span>
        </span>

        {value != null && value > 0 && (
          <span
            className={`block text-[10px] font-mono tabular-nums ${
              selected ? 'text-[#1a1a1a]/60' : 'text-slate-500'
            }`}
          >
            {fmtMoney(value)}
          </span>
        )}
      </span>
    </Link>
  )
}
