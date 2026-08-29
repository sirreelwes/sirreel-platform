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
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useJobsList } from './JobsListProvider'
import {
  BOARD_PHASES,
  PHASE_META,
  STATE,
  fmtDate,
  fmtMoney,
  jobPhase,
  jobWindow,
  rowValue,
  stateLabel,
  type BoardPhase,
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
  // Mobile pane switcher. The retired board's three columns can't sit
  // side by side on a 390px screen, so they become panes over the one
  // list — same placement rule (jobPhase), one column of cards at a
  // time. `null` = All, and it is the default: the rail is also the
  // primary way around HQ on a phone, and a search that silently
  // excluded two thirds of its matches would be a trap.
  const [phaseTab, setPhaseTab] = useState<BoardPhase | null>(null)

  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selectedId) return
    const el = listRef.current?.querySelector(`[data-job-id="${selectedId}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, rows.length])

  // Counts come from the full filtered list, so a tab's number is the
  // same whether or not that tab is the one showing.
  const phaseCounts = new Map<BoardPhase, number>()
  for (const r of rows) {
    const p = jobPhase(r.state)
    phaseCounts.set(p, (phaseCounts.get(p) ?? 0) + 1)
  }
  const paneRows = phaseTab ? rows.filter((r) => jobPhase(r.state) === phaseTab) : rows

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
          {loading ? 'Loading…' : error ? 'Error' : `${paneRows.length} ${paneRows.length === 1 ? 'job' : 'jobs'}`}
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

      {/* Phase panes — PHONE ONLY. Desktop keeps the single colour-coded
          list; three columns were retired there on purpose. */}
      <div className="md:hidden flex border-b border-zinc-200 bg-white">
        {([null, ...BOARD_PHASES] as (BoardPhase | null)[]).map((p) => {
          const on = phaseTab === p
          const count = p === null ? rows.length : (phaseCounts.get(p) ?? 0)
          return (
            <button
              key={p ?? 'all'}
              onClick={() => setPhaseTab(p)}
              title={p === null ? 'Every job in the current filter' : PHASE_META[p].hint}
              className={`flex-1 min-h-[44px] px-1 text-[11px] font-semibold border-b-2 transition-colors ${
                on
                  ? 'border-amber-500 text-zinc-900 bg-amber-50'
                  : 'border-transparent text-zinc-500 active:bg-zinc-100'
              }`}
            >
              {p === null ? 'All' : PHASE_META[p].title}
              <span className={`ml-1 tabular-nums ${on ? 'text-amber-700' : 'text-zinc-400'}`}>{count}</span>
            </button>
          )
        })}
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto py-1">
        {loading && rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-zinc-400">Loading…</div>
        ) : error ? (
          <div className="px-3 py-6 text-center text-[11px] text-red-600">{error}</div>
        ) : paneRows.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-zinc-400">
            {phaseTab
              ? `Nothing in ${PHASE_META[phaseTab].title}.`
              : status === 'orphans'
                ? 'No abandoned quotes. Good housekeeping.'
                : status === 'archived'
                  ? 'Nothing archived.'
                  : 'No jobs match.'}
          </div>
        ) : (
          paneRows.map(({ job, state }) => (
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
  const { refresh } = useJobsList()
  // One-click physical-return confirmation on Not-returned rows (Wes
  // 2026-08-28) — same POST the job detail header uses; returnedAt is
  // what rowState() clears 'overdue' with. Until returns are worked in
  // HQ day-to-day, this keeps the red band from re-accreting one row
  // at a time.
  const [marking, setMarking] = useState(false)

  const phase = jobPhase(state)

  /**
   * Phase moves — the retired board's ‹ › and manual·reset, restored on
   * the row. They were the only UI that could write or clear
   * sr_job_board_overrides; when the board went, a job someone had
   * manually placed had no way back to its computed state, and the
   * override kept overriding.
   *
   * Semantics are the board's, unchanged: PREJOB↔OUT is the
   * presentation-only override; a move INTO Back is the semantic
   * mark-returned (the gear is physically here) and a move OUT of Back
   * is unmark-returned. Never Job.status — that stays the three human
   * off-ramps.
   */
  const move = async (e: MouseEvent, target: BoardPhase | null) => {
    e.preventDefault()
    e.stopPropagation()
    if (marking) return
    setMarking(true)
    try {
      let r: Response
      if (target === 'BACK') {
        r = await fetch(`/api/jobs/${j.id}/mark-returned`, { method: 'POST' })
      } else if (phase === 'BACK') {
        // Any move off a returned row clears the physical-return mark;
        // the row reverts to its computed state — usually Not returned.
        r = await fetch(`/api/jobs/${j.id}/unmark-returned`, { method: 'POST' })
      } else {
        r = await fetch(`/api/jobs/${j.id}/board-phase`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phase: target }),
        })
      }
      if (r.ok) refresh()
      else alert('Move failed')
    } catch {
      alert('Move failed')
    } finally {
      setMarking(false)
    }
  }

  const markReturned = (e: MouseEvent) => move(e, 'BACK')

  // ‹ steps back a phase, › steps forward. Prejob has no left, Back
  // has no right.
  const leftTarget: BoardPhase | null = phase === 'OUT' ? 'PREJOB' : phase === 'BACK' ? 'OUT' : null
  const rightTarget: BoardPhase | null = phase === 'PREJOB' ? 'OUT' : phase === 'OUT' ? 'BACK' : null
  const overridden = !!j.boardPhaseOverride && phase !== 'BACK'

  const moveBtn = (target: BoardPhase, glyph: string) => (
    <button
      onClick={(e) => move(e, target)}
      disabled={marking}
      title={`Move to ${PHASE_META[target].title} — ${PHASE_META[target].hint}`}
      aria-label={`Move to ${PHASE_META[target].title}`}
      className={`flex items-center justify-center rounded border leading-none disabled:opacity-40 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 md:w-5 md:h-5 text-[15px] md:text-[12px] ${
        selected
          ? 'border-zinc-900/25 text-zinc-900/70 hover:bg-white/60'
          : 'border-zinc-200 text-zinc-400 hover:border-zinc-400 hover:text-zinc-700'
      }`}
    >
      {glyph}
    </button>
  )

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
          {state === 'overdue' && (
            <button
              onClick={markReturned}
              disabled={marking}
              title="The gear is back — confirm the return and clear Not returned"
              className="text-[10px] md:text-[8.5px] font-bold uppercase tracking-wider px-2.5 md:px-1.5 min-h-[44px] md:min-h-0 md:py-0.5 rounded whitespace-nowrap bg-white border border-red-300 text-red-700 hover:bg-red-600 hover:border-red-600 hover:text-white disabled:opacity-50"
            >
              {marking ? '…' : '✓ returned'}
            </button>
          )}
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

        {/* Line 5 — phase controls. Board vocabulary, on the row rather
            than in columns: ‹ › step the job between Prejob / Out /
            Back, and manual·reset drops a hand placement so the row goes
            back to reading its own cadence. 44px targets on a phone;
            they shrink to the old glyph size on a mouse. */}
        <span className="flex items-center gap-1.5 mt-1 md:mt-0.5">
          {overridden && (
            <button
              onClick={(e) => move(e, null)}
              disabled={marking}
              title="Clear manual placement — the row returns to its computed state"
              className={`text-[10px] md:text-[9px] underline underline-offset-2 disabled:opacity-40 min-h-[44px] md:min-h-0 pr-1 ${
                selected ? 'text-zinc-900/60 hover:text-zinc-900' : 'text-zinc-400 hover:text-zinc-700'
              }`}
            >
              manual · reset
            </button>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            {leftTarget && moveBtn(leftTarget, '‹')}
            {rightTarget && moveBtn(rightTarget, '›')}
          </span>
        </span>
      </span>
    </Link>
  )
}
