'use client'

/**
 * The /jobs list — a dark, always-present index on the left, with the
 * selected job's detail in the panel to its right.
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
import { rowNotReady, useJobsList, type Sort, type StatusFilter } from './JobsListProvider'
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
import { readinessApplies, readinessChipText } from '@/lib/jobs/readiness'
import { inquiryPastResponseSla } from '@/lib/sales/inquirySla'

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
  { id: 'archived', label: 'Archived' },
]

const SORT_OPTIONS: { id: Sort; label: string }[] = [
  { id: 'urgency', label: 'Urgency' },
  { id: 'dates', label: 'Dates' },
  { id: 'value', label: 'Value' },
  { id: 'newest', label: 'Newest' },
]

export function JobsSidebar() {
  const {
    rows, allRows, counts, loading, error,
    search, setSearch,
    status, setStatus,
    mine, setMine,
    sort, setSort,
    stateFilter, setStateFilter,
  } = useJobsList()

  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedId = pathname?.startsWith('/jobs/') ? pathname.slice('/jobs/'.length).split('/')[0] : null
  // Below `md` the split can't hold both, so the list IS /jobs and
  // the detail IS /jobs/[id] — same URLs, one pane at a time.
  // ?panel=incoming counts as a selection: it's the mobile route INTO
  // the landing workspace (the Incoming strip below links there), so
  // the list yields the viewport the same way a job detail does.
  const incomingPanel = searchParams?.get('panel') === 'incoming'
  const selected = !!selectedId || incomingPanel

  // Pending-incoming count for the strip — the same two streams
  // NewInboundColumn merges (persistent NEW inquiries + Gmail
  // suggestions), counted the same way, on the same 60s cadence.
  const [incomingCount, setIncomingCount] = useState<number | null>(null)
  // Inquiries past the first-response SLA — turns the strip red so
  // the breach is visible even from a job detail page.
  const [incomingOverdue, setIncomingOverdue] = useState(0)
  useEffect(() => {
    let active = true
    const load = () => {
      Promise.all([
        fetch('/api/inquiries?status=NEW').then((r) => r.json()).catch(() => ({})),
        fetch('/api/sales/suggested-inquiries').then((r) => r.json()).catch(() => ({})),
      ]).then(([inq, sug]) => {
        if (!active) return
        const rows = (inq?.inquiries ?? []) as {
          source: string; respondedAt?: string | null; createdAt: string
        }[]
        const pending = rows.filter((i) => !i.respondedAt)
        setIncomingCount(pending.length + ((sug?.suggestions ?? []) as unknown[]).length)
        setIncomingOverdue(
          pending.filter((i) => inquiryPastResponseSla({ ...i, respondedAt: i.respondedAt ?? null })).length,
        )
      })
    }
    load()
    const t = setInterval(load, 60_000)
    return () => { active = false; clearInterval(t) }
  }, [])

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
  // The second axis — outbound rows the five-check rollup says can't go
  // out yet. Same chip pattern as the states; counts only the rows the
  // chip itself would show (readiness is omitted everywhere else).
  const notReadyCount = allRows.filter((r) => rowNotReady(r.job, r.state)).length

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
      <div className="px-3 pt-3 pb-2 space-y-2 border-b border-zinc-200 bg-zinc-50">
        <div className="flex items-baseline gap-2">
          <h1 className="text-[13px] font-bold uppercase tracking-[0.18em] text-zinc-900">Jobs</h1>
          <span className="text-[11px] text-zinc-400">
            {loading ? 'loading…' : error ? 'error' : `${rows.length}${stateFilter ? ` of ${[...counts.values()].reduce((a, b) => a + b, 0)}` : ''}`}
          </span>
          <label className="ml-auto flex items-center gap-1.5 text-[11px] text-zinc-500 cursor-pointer">
            <input
              type="checkbox"
              checked={mine}
              onChange={(e) => setMine(e.target.checked)}
              className="accent-amber-500"
            />
            Mine
          </label>
          {selected && (
            <button
              onClick={() => setCollapsed(true)}
              title="Collapse the list — give the job detail the width"
              className="hidden md:block text-[13px] leading-none text-zinc-400 hover:text-zinc-900 px-1"
            >
              ‹
            </button>
          )}
        </div>

        {/* Incoming — the lifecycle's front door. Inquiries are
            pre-jobs (no Job row yet), so they are NOT rows in this
            list; the strip hands you to the landing workspace where
            the queue lives. Count = pending inbound, both streams. */}
        <Link
          href="/jobs?panel=incoming"
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-colors ${
            incomingOverdue > 0
              ? 'border-red-300 bg-red-50 hover:bg-red-100'
              : !selectedId && incomingCount !== null && incomingCount > 0
                ? 'border-amber-300 bg-amber-50 hover:bg-amber-100'
                : 'border-zinc-200 bg-white hover:bg-zinc-100'
          }`}
        >
          <span className="text-[13px]">📥</span>
          <span className="text-[12px] font-semibold text-zinc-800">Incoming</span>
          {incomingOverdue > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-wide text-red-600">
              {incomingOverdue} waiting
            </span>
          )}
          {incomingCount !== null && (
            <span
              className={`ml-auto text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded ${
                incomingOverdue > 0
                  ? 'bg-red-500 text-white'
                  : incomingCount > 0
                    ? 'bg-amber-500 text-white'
                    : 'bg-zinc-100 text-zinc-500'
              }`}
            >
              {incomingCount}
            </span>
          )}
        </Link>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search job, code, company, contact…"
          className="w-full px-2.5 py-1.5 bg-white border border-zinc-300 rounded-lg text-[12px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-amber-500"
        />

        <div className="flex items-center gap-1.5">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="flex-1 min-w-0 px-2 py-1 bg-white border border-zinc-300 rounded-md text-[11px] text-zinc-700 focus:outline-none focus:border-amber-500"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.id} value={o.id} className="bg-white">
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            title="Sort order"
            className="px-2 py-1 bg-white border border-zinc-300 rounded-md text-[11px] text-zinc-700 focus:outline-none focus:border-amber-500"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id} className="bg-white">
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
                    on ? 'bg-zinc-900 text-white font-bold' : 'text-zinc-500 hover:bg-zinc-200'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-sm ${STATE[s].rail}`} />
                  {STATE[s].short}
                  <span className={on ? 'font-bold' : 'text-zinc-400'}>{counts.get(s)}</span>
                </button>
              )
            })}
            {notReadyCount > 0 && (
              <button
                onClick={() => setStateFilter(stateFilter === 'not-ready' ? null : 'not-ready')}
                title="Outbound jobs still missing paperwork, a card, a driver, or a unit — click to show only these"
                className={`flex items-center gap-1 text-[10px] rounded px-1 py-0.5 ${
                  stateFilter === 'not-ready'
                    ? 'bg-zinc-900 text-white font-bold'
                    : 'text-rose-700 hover:bg-zinc-200'
                }`}
              >
                <span className="w-2 h-2 rounded-sm border border-rose-500" />
                Not ready
                <span className={stateFilter === 'not-ready' ? 'font-bold' : 'text-rose-500'}>
                  {notReadyCount}
                </span>
              </button>
            )}
            {stateFilter && (
              <button
                onClick={() => setStateFilter(null)}
                className="text-[10px] text-zinc-400 underline underline-offset-2 hover:text-zinc-900"
              >
                clear
              </button>
            )}
          </div>
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
