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
 * 2026-09-06 — TILES, not rows (Wes: "the job tiles need to be larger
 * with more info on the actual tile instead of cryptic color coding.
 * I'd rather have the tiles take half the screen width in laptop
 * view"). The rail is half the viewport from `md` up, and each job is
 * a card that SAYS what the old two-letter chips and hue implied:
 * the full state in words, who the job is for and who is running it,
 * what gear is on it (with the units already assigned), what is still
 * missing before it can go out, what the client owes, and when it was
 * last touched. The colored rail survives as a glanceable second cue
 * for people who learned it, but nothing on the tile depends on it.
 *
 * It is a LIGHT panel on purpose. The first cut wore the nav's own
 * dark chrome and brand gold, which put two near-identical dark
 * columns side by side and made the eye work to tell "which page am
 * I on" from "which job am I in". White plate, amber selection: the
 * nav stays the nav, this is the index.
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
  fmtMoney,
  fmtRelative,
  gearSummary,
  holdsFullyReleased,
  jobPhase,
  listDays,
  rowValue,
  stateLabel,
  type BillingRollupState,
  type BoardPhase,
  type JobRow,
  type RowState,
} from '@/lib/jobs/listRow'
import { readinessApplies } from '@/lib/jobs/readiness'
import type { BlockerTone } from '@/lib/jobs/readiness'
import { AlertTriangle, Check, EyeOff, Truck, User, UserCircle } from 'lucide-react'

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
  // Same day boundary the list's own states are derived from, so the
  // Released badge can't disagree with the row it sits on.
  const { today } = listDays()

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
      className={`${selected ? 'hidden md:flex' : 'flex'} w-full ${
        // Half the viewport on the landing (Wes 2026-09-06); narrower the
        // moment something is OPEN in the right pane, so it gets the room
        // back without a click. The tiles wrap rather than truncate at
        // this width, and the ‹ collapse above still takes the rail to a
        // sliver. `selected`, not selectedId: clicking Incoming is a
        // request to WORK in that panel — keeping the rail at half the
        // viewport there squeezed the incoming workspace's two columns
        // until quote names and amounts truncated (2026-09-09).
        selected ? 'md:w-[24rem] xl:w-[27rem]' : 'md:w-1/2 2xl:w-[50rem]'
      } flex-shrink-0 bg-white text-zinc-700 flex-col border-r border-zinc-200 transition-[width] duration-200`}
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

      {/* Phase panes — PHONE ONLY. Desktop keeps the single list; three
          columns were retired there on purpose. */}
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

      <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-2 bg-zinc-50">
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
            <JobTile key={job.id} job={job} state={state} today={today} selected={job.id === selectedId} />
          ))
        )}
      </div>
    </aside>
  )
}

// ─── The tile's vocabulary ───────────────────────────────────────

/** The blocker's state colour — the SAME split the detail page's
 *  paperwork strip draws: rose when nothing is on file, amber when
 *  something is in motion and waiting on a person. The words come from
 *  computeReadiness (blocker.detail), not from here. */
const BLOCKER_TONE: Record<BlockerTone, string> = {
  missing: 'border-rose-300 text-rose-700 bg-white',
  waiting: 'border-amber-300 text-amber-700 bg-white',
}

/** One sentence under the state pill — what the state MEANS for the
 *  person reading it, so nobody has to decode a hue. */
const STATE_HINT: Record<RowState, string> = {
  overdue: 'Past its return and nobody confirmed the gear is back',
  'returning-today': 'Gear is due back today',
  'picking-today': 'Goes out today',
  'returning-tmw': 'Gear is due back tomorrow',
  'picking-tmw': 'Goes out tomorrow',
  'on-rental': 'Gear is out with the client',
  booked: 'Locked in, nothing out yet',
  new: 'Just came in — no quote sent yet',
  drafted: 'A quote is already written on this job — finish it, don’t start over',
  quoted: 'Quote is with the client',
  hold: 'Client paused it',
  back: 'Gear is back in the yard',
  cancelled: 'Every booking on it was cancelled',
  lost: 'Did not win it',
}

const BILLING_WORDS: Partial<Record<BillingRollupState, { label: string; cls: string }>> = {
  OVERDUE: { label: 'Invoice overdue', cls: 'bg-chip-bad-bg text-chip-bad-fg' },
  SENT: { label: 'Invoice sent', cls: 'bg-chip-warn-bg text-chip-warn-fg' },
  PARTIALLY_PAID: { label: 'Partially paid', cls: 'bg-chip-warn-bg text-chip-warn-fg' },
  PAID: { label: 'Paid', cls: 'bg-chip-good-bg text-chip-good-fg' },
}

const ROLE_WORD: Record<string, string> = {
  PRODUCER: 'Producer',
  PM: 'PM',
  PC: 'PC',
  TRANSPO: 'Transpo',
  ACCOUNTING: 'Accounting',
  OTHER: 'Contact',
}

function JobTile({
  job: j,
  state,
  today,
  selected,
}: {
  job: JobRow
  state: RowState
  today: string
  selected: boolean
}) {
  const meta = STATE[state]
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
   * the tile. They were the only UI that could write or clear
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

  const moveBtn = (target: BoardPhase, word: string) => (
    <button
      onClick={(e) => move(e, target)}
      disabled={marking}
      title={`Move to ${PHASE_META[target].title} — ${PHASE_META[target].hint}`}
      className="text-[11px] font-semibold px-2 min-h-[44px] md:min-h-0 md:py-0.5 rounded border border-zinc-200 text-zinc-500 hover:border-zinc-400 hover:text-zinc-900 disabled:opacity-40"
    >
      {word}
    </button>
  )

  // The pill keeps its hue in both selection states. `overdue` is solid
  // red either way — it's the one state that should shout.
  const pillCls = state === 'overdue' ? 'bg-red-600 text-white' : `${meta.tint} ${meta.fg}`

  const contact = j.primaryContact
  const contactName = contact
    ? [contact.firstName, contact.lastName].filter((s) => s && s.trim()).join(' ').trim()
    : ''
  const gear = gearSummary(j)
  const orderCount = j._count?.orders ?? 0

  // Readiness — outbound rows only (the same rule as before: an
  // unpapered quote is a normal quote). On the tile every blocker is
  // spelled out rather than "COI +3".
  const readiness = readinessApplies(state) && j.readiness ? j.readiness : null
  const toBook = j.approvedUnbooked ?? 0
  const redlines = j.redlinePending ?? 0
  const billing = j.billing && BILLING_WORDS[j.billing.state] ? j.billing : null
  // Fleet handed back (Wes 2026-09-08: "the job tile also needs to have
  // released clearly readable and may be a red outline"). It outranks the
  // selected/hover outline below because it is a fact about the gear, not
  // about what the cursor is doing.
  const released = holdsFullyReleased(j, today)
  const rel = j.releasedHolds
  const touched = fmtRelative(j.lastActivityAt ?? j.createdAt)

  return (
    <Link
      href={`/jobs/${j.id}`}
      data-job-id={j.id}
      className={`group flex items-stretch rounded-lg border overflow-hidden transition-colors ${
        selected
          ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-500'
          : released
            ? 'border-red-500 ring-1 ring-red-500 bg-white hover:bg-red-50/40'
            : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50/60'
      }`}
    >
      {/* Rail — the old color code, kept as a second cue. */}
      <span className={`w-1.5 flex-shrink-0 ${meta.rail}`} aria-hidden="true" />

      <span className="flex-1 min-w-0 px-3 py-2.5 flex flex-col gap-1.5">
        {/* Row 1 — code + markers on the left, the state in words on the right. */}
        <span className="flex items-start gap-2">
          <span className="flex items-center gap-1.5 flex-wrap min-w-0">
            <span className="text-[11px] font-mono font-bold text-zinc-400">
              {j.jobCode.replace(/^SR-JOB-/, '')}
            </span>
            {j.origin === 'HQ' && (
              <span
                className="text-[9px] font-bold uppercase tracking-wider px-1 rounded bg-amber-600 text-white"
                title="Booked in HQ — this one is ours to run. Nothing else is tracking it."
              >
                HQ
              </span>
            )}
            {j.archivedAt && (
              <span
                className="text-[9px] font-bold uppercase tracking-wider px-1 rounded bg-zinc-200 text-zinc-600"
                title="Archived — hidden from the default list"
              >
                Archived
              </span>
            )}
            {j.hasDelivery && state !== 'back' && (
              <span
                className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider px-1 rounded bg-sky-100 text-sky-800"
                title="A booking on this job has a delivery address"
              >
                <Truck size={9} aria-hidden /> Delivery
              </span>
            )}
            {(j.blindPickup || j.blindReturn) && (
              <span
                className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider px-1 rounded bg-zinc-100 text-zinc-600"
                title={`Blind ${[j.blindPickup && 'pickup', j.blindReturn && 'return'].filter(Boolean).join(' + ')} — the driver handles it without staff`}
              >
                <EyeOff size={9} aria-hidden /> Blind {j.blindPickup && j.blindReturn ? 'both ways' : j.blindPickup ? 'pickup' : 'return'}
              </span>
            )}
            {j.hasLD && (
              <span
                className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider px-1 rounded bg-chip-bad-bg text-chip-bad-fg"
                title="Loss & Damage claim open"
              >
                <AlertTriangle size={9} aria-hidden /> L&amp;D claim
              </span>
            )}
          </span>
          <span className="ml-auto flex items-center gap-1.5 flex-shrink-0">
            {released && (
              <span
                className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded whitespace-nowrap bg-red-600 text-white"
                title={
                  rel
                    ? `Holds released — ${rel.ours} of ours, ${rel.partner} partner unit${rel.partner === 1 ? '' : 's'} handed back. Nothing is still held for this job.`
                    : 'Holds released — nothing is still held for this job'
                }
              >
                Released
              </span>
            )}
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded whitespace-nowrap ${pillCls}`}
              title={STATE_HINT[state]}
            >
              {stateLabel(j, state)}
            </span>
            {state === 'overdue' && (
              <button
                onClick={markReturned}
                disabled={marking}
                title="The gear is back — confirm the return and clear Not returned"
                className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 min-h-[44px] md:min-h-0 md:py-0.5 rounded whitespace-nowrap bg-white border border-red-300 text-red-700 hover:bg-red-600 hover:border-red-600 hover:text-white disabled:opacity-50"
              >
                <Check size={10} aria-hidden /> {marking ? '…' : 'It’s back'}
              </button>
            )}
          </span>
        </span>

        {/* Row 2 — the name, and what the money says. */}
        <span className="flex items-baseline gap-3">
          <span className="text-[15px] font-semibold leading-tight text-zinc-900 truncate">{j.name}</span>
          {value != null && value > 0 && (
            <span className="ml-auto text-[13px] font-mono tabular-nums text-zinc-700 flex-shrink-0">
              {fmtMoney(value)}
            </span>
          )}
        </span>

        {/* Row 3 — who. Company · client contact · our agent. */}
        <span className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[12px] leading-tight text-zinc-600">
          <span className="font-medium text-zinc-800 truncate max-w-full">{j.company?.name || 'No company yet'}</span>
          {contactName && (
            <span className="inline-flex items-center gap-1 min-w-0" title={contact?.email || undefined}>
              <User size={11} aria-hidden className="text-zinc-400 flex-shrink-0" />
              <span className="truncate">
                {contactName}
                {/* OTHER carries no information — "Luis · Contact" says
                    less than "Luis". Only a real role gets the word. */}
                {contact?.role && contact.role !== 'OTHER' && (
                  <span className="text-zinc-400"> · {ROLE_WORD[contact.role] ?? contact.role}</span>
                )}
              </span>
            </span>
          )}
          {j.agent?.name && (
            <span className="inline-flex items-center gap-1 text-zinc-500" title="SirReel agent on this job">
              <UserCircle size={11} aria-hidden className="text-zinc-400 flex-shrink-0" />
              {j.agent.name}
            </span>
          )}
        </span>

        {/* Row 4 — what. Gear by category with the units already on it,
            and how many orders carry it. Omitted when nothing is booked
            (order-only legacy jobs) rather than printing "no gear". */}
        {(gear || orderCount > 0) && (
          <span className="flex items-baseline gap-3 text-[12px] leading-snug text-zinc-600">
            {gear && <span className="min-w-0">{gear}</span>}
            {orderCount > 0 && (
              <span className="ml-auto flex-shrink-0 text-[11px] text-zinc-400 tabular-nums">
                {orderCount} {orderCount === 1 ? 'order' : 'orders'}
              </span>
            )}
          </span>
        )}

        {/* Row 5 — what's in the way, and what's owed. Each is a
            sentence-chip, not an abbreviation. Omitted entirely when
            there is nothing to say. */}
        {(readiness || toBook > 0 || redlines > 0 || billing) && (
          <span className="flex items-center gap-1.5 flex-wrap pt-0.5">
            {redlines > 0 && (
              <span
                title={`Client redlined the agreement on ${redlines} order${redlines === 1 ? '' : 's'} — waiting on us`}
                className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-rose-600 text-white"
              >
                <AlertTriangle size={10} aria-hidden />
                Client redlined the agreement{redlines > 1 ? ` ×${redlines}` : ''}
              </span>
            )}
            {toBook > 0 && (
              <span
                title={`${toBook} approved order${toBook === 1 ? '' : 's'} waiting to be booked`}
                className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-amber-600 text-white"
              >
                Approved — book it{toBook > 1 ? ` ×${toBook}` : ''}
              </span>
            )}
            {readiness && readiness.ready && (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-chip-good-bg text-chip-good-fg">
                <Check size={10} aria-hidden /> Ready to go out
              </span>
            )}
            {readiness && !readiness.ready && (
              <span
                className="inline-flex items-center gap-1 flex-wrap text-[10.5px]"
                title={`${readiness.done} of ${readiness.total} checks clear`}
              >
                {/* "Still needed", not "Missing" — a COI awaiting HQ
                    approval or an agreement out for signature is on file
                    and in motion; calling it missing sent agents to chase
                    the client for paperwork we already had. */}
                <span className={`font-semibold ${readiness.blockers.some((b) => b.tone === 'missing') ? 'text-rose-700' : 'text-amber-700'}`}>
                  Still needed:
                </span>
                {readiness.blockers.map((b) => (
                  <span
                    key={b.key}
                    className={`font-semibold px-1.5 py-0.5 rounded border ${BLOCKER_TONE[b.tone]}`}
                  >
                    {b.detail}
                  </span>
                ))}
              </span>
            )}
            {billing && (
              <span
                className={`ml-auto text-[10.5px] font-semibold px-1.5 py-0.5 rounded tabular-nums ${BILLING_WORDS[billing.state]!.cls}`}
              >
                {BILLING_WORDS[billing.state]!.label}
                {billing.balanceDue > 0 && ` · ${fmtMoney(billing.balanceDue)} due`}
              </span>
            )}
          </span>
        )}

        {/* Row 6 — when it was last touched, and the phase controls. */}
        <span className="flex items-center gap-2 pt-0.5 text-[11px] text-zinc-400">
          {touched && <span>Last activity {touched}</span>}
          {j.returnedAt && state === 'back' && (
            <span>· returned{j.returnedBy?.name ? ` by ${j.returnedBy.name}` : ''}</span>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            {overridden && (
              <button
                onClick={(e) => move(e, null)}
                disabled={marking}
                title="Clear manual placement — the row returns to its computed state"
                className="text-[10px] underline underline-offset-2 disabled:opacity-40 min-h-[44px] md:min-h-0 pr-1 text-zinc-400 hover:text-zinc-700"
              >
                placed by hand · reset
              </button>
            )}
            {leftTarget && moveBtn(leftTarget, `‹ ${PHASE_META[leftTarget].title}`)}
            {rightTarget && moveBtn(rightTarget, `${PHASE_META[rightTarget].title} ›`)}
          </span>
        </span>
      </span>
    </Link>
  )
}
