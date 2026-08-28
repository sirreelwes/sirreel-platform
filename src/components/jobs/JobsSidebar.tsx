'use client'

/**
 * The /jobs list — an always-present index on the left, with the
 * selected job's detail in the panel to its right.
 *
 * As of 2026-08-28 (Wes: "turn this section into a bar at the top")
 * this component is JUST the list. Search, status/sort, the Mine
 * toggle, the Incoming strip and the color legend all live in
 * JobsToolbar, the full-width command bar the layout renders above
 * the split — the controls stopped burying the rows they filtered.
 *
 * It is a LIGHT panel on purpose. The first cut wore the nav's own
 * dark chrome and brand gold, which put two near-identical dark
 * columns side by side and made the eye work to tell "which page am
 * I on" from "which job am I in". White plate, amber selection: the
 * nav stays the nav, this is the index. Cycle position is carried by
 * the saturated color rail on each item — no columns, no pre/on/post
 * grouping.
 *
 * Selection is the URL (`/jobs/[id]`), not local state: the layout
 * that owns this component persists across those navigations, so the
 * list keeps its scroll position, filter, and fetched rows while the
 * right panel swaps.
 */

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useJobsList } from './JobsListProvider'
import {
  STATE,
  fmtDate,
  fmtMoney,
  jobWindow,
  rowValue,
  stateLabel,
  type JobRow,
  type RowState,
} from '@/lib/jobs/listRow'
import { readinessApplies, readinessChipText } from '@/lib/jobs/readiness'

export function JobsSidebar() {
  const { rows, loading, error, status } = useJobsList()

  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedId = pathname?.startsWith('/jobs/') ? pathname.slice('/jobs/'.length).split('/')[0] : null
  // Below `md` the split can't hold both, so the list IS /jobs and
  // the detail IS /jobs/[id] — same URLs, one pane at a time.
  // ?panel=incoming counts as a selection: it's the mobile route INTO
  // the landing workspace (the toolbar's Incoming strip links there),
  // so the list yields the viewport the same way a job detail does.
  const incomingPanel = searchParams?.get('panel') === 'incoming'
  const selected = !!selectedId || incomingPanel

  // Keep the selected job in view when it's reached from elsewhere
  // (a link, a reload) rather than by clicking it in this list.
  const [collapsed, setCollapsed] = useState(false)

  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selectedId) return
    const el = listRef.current?.querySelector(`[data-job-id="${selectedId}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, rows.length])

  if (collapsed && selected) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="Show the job list"
        className="hidden md:flex w-8 flex-shrink-0 bg-white border-r border-zinc-200 flex-col items-center gap-2 pt-3 text-zinc-400 hover:text-zinc-900"
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
      } w-full md:w-[17rem] xl:w-[19rem] 2xl:w-[21rem] flex-shrink-0 bg-white text-zinc-700 flex-col border-r border-zinc-200`}
    >
      {/* Slim strip: just the count and the collapse affordance — every
          control moved up into JobsToolbar. */}
      <div className="px-3 py-1.5 border-b border-zinc-200 bg-zinc-50 flex items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
          {loading ? 'Loading…' : error ? 'Error' : `${rows.length} ${rows.length === 1 ? 'job' : 'jobs'}`}
        </span>
        {selected && (
          <button
            onClick={() => setCollapsed(true)}
            title="Collapse the list — give the job detail the width"
            className="hidden md:block ml-auto text-[13px] leading-none text-zinc-400 hover:text-zinc-900 px-1"
          >
            ‹
          </button>
        )}
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto py-1">
        {loading && rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-zinc-400">Loading…</div>
        ) : error ? (
          <div className="px-3 py-6 text-center text-[11px] text-red-600">{error}</div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-zinc-400">
            {status === 'orphans'
              ? 'No abandoned quotes. Good housekeeping.'
              : status === 'archived'
                ? 'Nothing archived.'
                : 'No jobs match.'}
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
  // behind it changes, so a selected row stays readable on amber
  // without losing what state it's in. `overdue` is solid red either
  // way — it's the one state that should shout.
  const pillCls =
    state === 'overdue'
      ? 'bg-red-600 text-white'
      : `${selected ? 'bg-white' : meta.tint} ${meta.fg}`

  return (
    <Link
      href={`/jobs/${j.id}`}
      data-job-id={j.id}
      className="group flex items-stretch gap-0 px-2 py-[3px]"
    >
      {/* Rail sits OUTSIDE the selection fill so the state color
          survives the amber highlight. */}
      <span className={`w-1 rounded-l flex-shrink-0 ${meta.rail}`} aria-hidden="true" />
      <span
        className={`flex-1 min-w-0 rounded-r px-2 py-1.5 transition-colors ${
          selected ? 'bg-amber-300 text-zinc-900' : 'bg-zinc-50 group-hover:bg-zinc-100'
        }`}
      >
        <span className="flex items-center gap-1.5">
          <span
            className={`text-[10.5px] font-mono font-bold ${selected ? 'text-zinc-900/60' : 'text-zinc-400'}`}
          >
            {j.jobCode.replace(/^SR-JOB-/, '')}
          </span>
          {j.archivedAt && (
            <span
              className={`text-[8px] font-bold uppercase tracking-wider px-1 rounded ${
                selected ? 'bg-zinc-900 text-zinc-300' : 'bg-zinc-200 text-zinc-600'
              }`}
              title="Archived — hidden from the default list"
            >
              Arch
            </span>
          )}
          {j.hasLD && (
            <span className={selected ? 'text-red-800 text-[10px]' : 'text-red-500 text-[10px]'} title="Loss & Damage claim open">
              ▲
            </span>
          )}
          {j.hasDelivery && state !== 'back' && (
            <span
              className={`text-[8px] font-bold uppercase tracking-wider px-1 rounded ${
                selected ? 'bg-zinc-900 text-amber-300' : 'bg-amber-500 text-white'
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

        <span className="block text-[12.5px] font-semibold leading-tight truncate text-zinc-900">
          {j.name}
        </span>

        <span
          className={`flex items-baseline gap-1.5 text-[10.5px] leading-tight ${
            selected ? 'text-zinc-900/70' : 'text-zinc-500'
          }`}
        >
          <span className="truncate">{j.company?.name || 'no company'}</span>
          <span className="ml-auto whitespace-nowrap tabular-nums">
            {w.start || w.end ? `${fmtDate(w.start)} → ${fmtDate(w.end)}` : 'no dates'}
          </span>
        </span>

        {/* Line 4 — readiness (outbound rows only) + value. The chip is
            the second axis: the pill says WHEN, this says WHAT'S MISSING,
            and the pill stays the louder of the two. Rose is OUTLINED,
            never solid — solid red is the overdue pill's monopoly. On a
            quoted/cancelled/returned row the chip is omitted entirely: an
            unpapered quote is a normal quote, and an indicator that
            scolds normal rows is wallpaper by Friday. */}
        {(() => {
          const r = readinessApplies(state) && j.readiness ? j.readiness : null
          if (!r && (value == null || value <= 0)) return null
          return (
            <span className="flex items-baseline gap-1.5">
              {r && (
                <span
                  title={
                    r.ready
                      ? 'All five checks clear — COI, agreement, card, driver, gear'
                      : `Missing: ${r.blockers.map((b) => b.label).join(', ')} (${r.done} of ${r.total} done)`
                  }
                  className={`text-[9px] font-bold uppercase tracking-wider px-1 py-px rounded border whitespace-nowrap ${
                    r.ready
                      ? selected
                        ? 'border-emerald-700/50 text-emerald-900'
                        : 'border-emerald-200 text-emerald-600'
                      : selected
                        ? 'border-rose-700/60 text-rose-900'
                        : 'border-rose-300 text-rose-600'
                  }`}
                >
                  {readinessChipText(r)}
                </span>
              )}
              {value != null && value > 0 && (
                <span
                  className={`ml-auto text-[10px] font-mono tabular-nums ${
                    selected ? 'text-zinc-900/60' : 'text-zinc-400'
                  }`}
                >
                  {fmtMoney(value)}
                </span>
              )}
            </span>
          )
        })()}
      </span>
    </Link>
  )
}
