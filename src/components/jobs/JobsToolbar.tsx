'use client'

/**
 * The /jobs command bar — full-width, at the top of the whole surface,
 * directly under nothing: it CARRIES the page title (Wes 2026-08-28:
 * "turn this section into a bar at the top, right under 'Jobs' title" —
 * the title moved into the bar so the two read as one line).
 *
 * Everything that used to stack inside the left rail's header lives
 * here horizontally: the Incoming strip, search, status + sort, the
 * Mine toggle, and the color-legend chips as a slim second row. The
 * rail below is just the list — the controls stopped burying it.
 *
 * Renders from the /jobs LAYOUT (inside JobsListProvider — all state
 * is the shared list context), so it persists across detail
 * navigation exactly like the rail. On mobile it yields the viewport
 * to a selected detail/panel the same way the rail does.
 */

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Inbox, X } from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { rowNotReady, useJobsList, type Sort, type StatusFilter } from './JobsListProvider'
import { NewJobLauncher } from './NewJobLauncher'
import { STATE, URGENCY } from '@/lib/jobs/listRow'
import { inquiryPastResponseSla } from '@/lib/sales/inquirySla'

const STATUS_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All jobs' },
  // Wes 2026-09-01. Second in the list, right under "All", because it is
  // the answer to "what is actually mine to run today" on a board that
  // is 85% imports.
  { id: 'hq', label: 'Booked in HQ' },
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
  // "Recent" leads and is the default. "Newest" sorts by when the JOB
  // was created, which means acting on a job — quoting it, sending it —
  // does not move it, and the thing you just worked on stays buried
  // wherever it was created. Recent sorts by when anything last
  // happened on it. See lastActivityAt in src/lib/jobs/listRow.ts.
  { id: 'recent', label: 'Recently touched' },
  { id: 'urgency', label: 'Urgency' },
  { id: 'dates', label: 'Dates' },
  { id: 'value', label: 'Value' },
  { id: 'newest', label: 'Newest job' },
]

export function JobsToolbar() {
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
  const searchRef = useRef<HTMLInputElement>(null)
  const selectedId = pathname?.startsWith('/jobs/') ? pathname.slice('/jobs/'.length).split('/')[0] : null
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
        const rows2 = (inq?.inquiries ?? []) as {
          source: string; respondedAt?: string | null; createdAt: string
        }[]
        const pending = rows2.filter((i) => !i.respondedAt)
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

  // Only states actually present get a key entry — a legend full of
  // zeroes is noise.
  const keyStates = URGENCY.filter((s) => (counts.get(s) ?? 0) > 0)
  // The second axis — outbound rows the five-check rollup says can't go
  // out yet. Same chip pattern as the states; counts only the rows the
  // chip itself would show (readiness is omitted everywhere else).
  const notReadyCount = allRows.filter((r) => rowNotReady(r.job, r.state)).length

  return (
    <div
      className={`${
        selected ? 'hidden md:block' : 'block'
      } flex-shrink-0 bg-white border-b border-zinc-200 px-4 pt-2.5 pb-2 space-y-1.5`}
    >
      {/* Row 1 — title + every control, one line (wraps when narrow). */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="flex items-baseline gap-2 mr-1">
          <h1 className="text-lg font-semibold text-zinc-900 leading-none">Jobs</h1>
          <span className="text-[11px] text-zinc-400 tabular-nums">
            {loading ? 'loading…' : error ? 'error' : `${rows.length}${stateFilter ? ` of ${[...counts.values()].reduce((a, b) => a + b, 0)}` : ''}`}
          </span>
        </div>

        {/* Incoming — the lifecycle's front door. Inquiries are
            pre-jobs (no Job row yet), so they are NOT rows in the
            rail; the strip hands you to the landing workspace where
            the queue lives. Count = pending inbound, both streams. */}
        <Link
          href="/jobs?panel=incoming"
          className={`flex items-center gap-1.5 px-2.5 py-1 min-h-[44px] md:min-h-0 rounded-lg border transition-colors ${
            incomingOverdue > 0
              ? 'border-red-300 bg-red-50 hover:bg-red-100'
              : incomingCount !== null && incomingCount > 0
                ? 'border-amber-300 bg-amber-50 hover:bg-amber-100'
                : 'border-zinc-200 bg-white hover:bg-zinc-100'
          }`}
        >
          <Inbox size={13} aria-hidden className="text-zinc-500" />
          <span className="text-[12px] font-semibold text-zinc-800">Incoming</span>
          {incomingOverdue > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-wide text-red-600">
              {incomingOverdue} waiting
            </span>
          )}
          {incomingCount !== null && (
            <span
              className={`text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded ${
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

        {/* Wes 2026-09-03: clearing the search meant holding backspace
            through the whole query. The X only appears once there is
            something to clear, and Escape does the same thing for
            anyone already typing. Padding-right reserves the button's
            lane so a long query never runs underneath it. */}
        <div className="order-last md:order-none relative w-full md:w-auto flex-1 md:min-w-[180px] max-w-full md:max-w-md">
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && search) {
                e.preventDefault()
                setSearch('')
              }
            }}
            placeholder="Search job, code, company, contact…"
            className={`w-full px-2.5 py-2 md:py-1.5 min-h-[44px] md:min-h-0 bg-white border border-zinc-300 rounded-lg text-[16px] md:text-[12px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-amber-500 ${
              search ? 'pr-9' : ''
            }`}
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              title="Clear search"
              onClick={() => {
                setSearch('')
                // Focus goes back to the field, not nowhere — the point
                // of clearing is usually to type something else.
                searchRef.current?.focus()
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
            >
              <X size={14} aria-hidden />
            </button>
          )}
        </div>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="px-2 py-2 md:py-1.5 min-h-[44px] md:min-h-0 bg-white border border-zinc-300 rounded-md text-[16px] md:text-[11px] text-zinc-700 focus:outline-none focus:border-amber-500"
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
          className="px-2 py-2 md:py-1.5 min-h-[44px] md:min-h-0 bg-white border border-zinc-300 rounded-md text-[16px] md:text-[11px] text-zinc-700 focus:outline-none focus:border-amber-500"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id} className="bg-white">
              {o.label}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 px-1 min-h-[44px] md:min-h-0 text-[12px] md:text-[11px] text-zinc-500 cursor-pointer">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => setMine(e.target.checked)}
            className="accent-amber-500"
          />
          Mine
        </label>

        {/* The ONE create entry point — moved here from the (deleted)
            global shell header (Wes 2026-08-28: "just have new job on
            the jobs page"). */}
        {/* Hidden on a phone: the shell's mobile top bar carries the same
            launcher on every route, and two "+ New Job" buttons on one
            screen is one too many. */}
        {/* Findable on the first visit, ignorable on the hundredth —
            the how-to sits next to the button it describes (same
            treatment Collections gives "How to collect"). */}
        <div className="ml-auto hidden md:flex items-center gap-2">
          <Link
            href="/guides/starting-a-job"
            className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-900 underline underline-offset-2 decoration-zinc-300"
          >
            How to start a job
          </Link>
          <NewJobLauncher buttonClassName="bg-zinc-900 hover:bg-zinc-800 text-white text-[12px] font-semibold px-3 py-1.5 rounded-lg" />
        </div>
      </div>

      {/* Row 2 — color key: legend for the rails, and a one-click narrow. */}
      {keyStates.length > 0 && (
        <div className="flex items-center gap-x-2 gap-y-1 flex-wrap overflow-x-auto">
          {keyStates.map((s) => {
            const on = stateFilter === s
            return (
              <button
                key={s}
                onClick={() => setStateFilter(on ? null : s)}
                title={`${STATE[s].label} — click to show only these`}
                className={`flex items-center gap-1 text-[11px] md:text-[10px] rounded px-1.5 md:px-1 py-1.5 md:py-0.5 whitespace-nowrap ${
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
              className={`flex items-center gap-1 text-[11px] md:text-[10px] rounded px-1.5 md:px-1 py-1.5 md:py-0.5 whitespace-nowrap ${
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
  )
}
