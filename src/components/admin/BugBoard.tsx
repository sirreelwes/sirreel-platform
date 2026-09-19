'use client'

/**
 * The to-do list on /admin/improvements.
 *
 * Every hook is above every early return — the repo has no ESLint, so
 * rules-of-hooks never runs (project_no_eslint_hooks_gap).
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, Bug, Check, ChevronDown, ChevronRight, ClipboardCheck, Copy, Layers, RefreshCw, Users, Wrench, X } from 'lucide-react'
import type { BugKind, BugRouting, BugSeverity, BugStatus } from '@prisma/client'
import type { BugContext } from '@/lib/bugs/clientContext'
import { rollupByArea, type AreaGroup } from '@/lib/bugs/rollup'
import {
  KIND_BLURB,
  KIND_LABEL,
  OPEN_STATUSES,
  ROUTING_CHIP,
  ROUTING_LABEL,
  SEVERITY_CHIP,
  SEVERITY_LABEL,
  STATUS_CHIP,
  STATUS_LABEL,
} from '@/lib/bugs/vocab'

export interface BoardReport {
  id: string
  createdAt: string
  body: string
  title: string | null
  area: string | null
  severity: BugSeverity
  kind: BugKind
  routing: BugRouting
  status: BugStatus
  reasoning: string | null
  response: string | null
  suspects: string[]
  reportedByName: string
  reportedByEmail: string
  reportedByRole: string | null
  pagePath: string | null
  /** What the browser saw — see src/lib/bugs/clientContext.ts. */
  context: BugContext | null
  missingContext: string | null
  triagedAt: string | null
  triageError: string | null
  escalatedAt: string | null
  duplicateOfId: string | null
  duplicateCount: number
  alsoReportedBy: { id: string; name: string; body: string; createdAt: string }[]
  resolvedAt: string | null
  resolvedByEmail: string | null
  resolutionNote: string | null
}

type Tab = 'todo' | 'escalated' | 'answered' | 'done'

const TABS: { key: Tab; label: string }[] = [
  { key: 'todo', label: 'To do' },
  { key: 'escalated', label: 'With Wes' },
  { key: 'answered', label: 'Answered' },
  { key: 'done', label: 'Closed' },
]

function fmt(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function BugBoard({ reports, setupNeeded }: { reports: BoardReport[]; setupNeeded: boolean }) {
  const [tab, setTab] = useState<Tab>('todo')
  const [rows, setRows] = useState(reports)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Ticked for hand-off to Claude Code (Wes 2026-09-19).
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [handing, setHanding] = useState(false)
  const [brief, setBrief] = useState<{ batchId: string; count: number; text: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const buckets = useMemo(() => {
    // Duplicates never appear on their own — they are shown inside the
    // report they joined, which is the whole point of grouping them.
    const parents = rows.filter((r) => !r.duplicateOfId)
    return {
      todo: parents.filter((r) => OPEN_STATUSES.includes(r.status) && r.routing !== 'ESCALATED'),
      escalated: parents.filter((r) => OPEN_STATUSES.includes(r.status) && r.routing === 'ESCALATED'),
      answered: parents.filter((r) => r.status === 'ANSWERED'),
      done: parents.filter((r) => r.status === 'FIXED' || r.status === 'WONT_FIX'),
    }
  }, [rows])

  async function patch(id: string, payload: Record<string, unknown>) {
    setBusy(id)
    try {
      const res = await fetch(`/api/bug-reports/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.ok && data.report) {
        setRows((prev) =>
          prev.map((r) =>
            r.id === id
              ? {
                  ...r,
                  status: data.report.status,
                  severity: data.report.severity,
                  kind: data.report.kind ?? r.kind,
                  routing: data.report.routing ?? r.routing,
                  title: data.report.title ?? r.title,
                  area: data.report.area ?? r.area,
                  reasoning: data.report.reasoning ?? r.reasoning,
                  response: data.report.response ?? r.response,
                  triagedAt: data.report.triagedAt ?? r.triagedAt,
                  triageError: data.report.triageError ?? null,
                  resolutionNote: data.report.resolutionNote ?? r.resolutionNote,
                }
              : r,
          ),
        )
      }
    } finally {
      setBusy(null)
    }
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // The aggregate: every open improvement grouped by the part of HQ it
  // lives in. Seven things wrong with Jobs/Orders are one afternoon for
  // someone already in that code, and thirty separate decisions otherwise.
  const groups: AreaGroup[] = useMemo(
    () =>
      rollupByArea(
        rows
          .filter((r) => !r.duplicateOfId && OPEN_STATUSES.includes(r.status))
          .map((r) => ({
            id: r.id, area: r.area, severity: r.severity, kind: r.kind, duplicateCount: r.duplicateCount,
          })),
      ),
    [rows],
  )
  const allOpenIds = useMemo(() => groups.flatMap((g) => g.ids), [groups])

  const list = buckets[tab]
  // "All" means all of what you are LOOKING at, not all 300 rows — ticking
  // a filtered list and getting the archive is the classic version of this
  // button being dangerous.
  const allPicked = list.length > 0 && list.every((r) => picked.has(r.id))

  function toggleAll() {
    setPicked((prev) => {
      const next = new Set(prev)
      if (allPicked) list.forEach((r) => next.delete(r.id))
      else list.forEach((r) => next.add(r.id))
      return next
    })
  }

  /**
   * Close everything selected in one action. The point Wes made: going
   * through them one at a time to record what was already done is the
   * worst part of running a list like this.
   */
  async function bulkSet(status: BugStatus) {
    if (picked.size === 0 || handing) return
    setHanding(true)
    try {
      const res = await fetch('/api/bug-reports/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...picked], status }),
      })
      const data = await res.json()
      if (res.ok) {
        const done: Set<string> = new Set(data.ids)
        setRows((prev) => prev.map((r) => (done.has(r.id) ? { ...r, status } : r)))
        setPicked(new Set())
      }
    } finally {
      setHanding(false)
    }
  }

  async function handToClaude(ids?: string[]) {
    const selection = ids ?? [...picked]
    if (selection.length === 0 || handing) return
    setHanding(true)
    try {
      const res = await fetch('/api/bug-reports/fix-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selection }),
      })
      const data = await res.json()
      if (res.ok) {
        setBrief({ batchId: data.batchId, count: data.count, text: data.brief })
        setPicked(new Set())
        // They are being worked now — reflect it without a reload.
        const sent = new Set(selection)
        setRows((prev) =>
          prev.map((r) => (sent.has(r.id) ? { ...r, status: 'IN_PROGRESS' as BugStatus } : r)),
        )
      }
    } finally {
      setHanding(false)
    }
  }

  return (
    // No width cap here — the PAGE owns the width now that the tally rail
    // sits beside this column (BugStatsRail). A max-width on both fights
    // the grid and strands the list left of its own rail.
    // The page owns the heading (it sits above the list|rail grid) — with it
    // in here, the stats rail stacked ABOVE the page title on a phone.
    <div>
      {setupNeeded && (
        <div className="mb-6 flex items-start gap-2 rounded-xl bg-chip-warn-bg px-4 py-3 text-sm text-chip-warn-fg">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            The <code>sr_bug_reports</code> table is not on this database yet — run{' '}
            <code>scripts/add-bug-reports-table.ts</code>. Until then the box on HQ Help refuses
            politely rather than losing reports.
          </span>
        </div>
      )}

      {/*
        The aggregate. Wes 2026-09-19: "an aggregation ability to look at all
        bugs and be able to send that to Claude and push a fix for that."
        Each area hands over as a unit, and the whole open list hands over
        in one press — the groups are the useful size of a job.
      */}
      {groups.length > 0 && (
        <div className="mb-5 rounded-xl border border-lt-hairline bg-lt-card p-4">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-lt-fg3" />
              <h2 className="text-[15px] font-semibold text-lt-fg">
                {allOpenIds.length} open, across {groups.length} part{groups.length === 1 ? '' : 's'} of HQ
              </h2>
            </div>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => handToClaude(allOpenIds)}
              disabled={handing}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-white"
            >
              <Wrench className="w-3.5 h-3.5" />
              Hand all {allOpenIds.length} to Claude
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {groups.map((g) => (
              <div
                key={g.area}
                className="flex items-center justify-between gap-3 rounded-lg bg-lt-inner px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-lt-fg truncate">{g.area}</div>
                  <div className="text-xs text-lt-fg3">
                    {g.count} open
                    {g.people > g.count ? ` · ${g.people} reports` : ''}
                    {g.blocking ? ' · blocking' : ` · worst ${SEVERITY_LABEL[g.worst].toLowerCase()}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handToClaude(g.ids)}
                  disabled={handing}
                  className="shrink-0 rounded-lg border border-lt-hairline bg-lt-card px-2.5 py-1.5 text-[11px] font-semibold text-lt-fg2 hover:text-lt-fg disabled:opacity-50"
                >
                  Hand over
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mb-5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-amber-600 text-white'
                : 'bg-lt-card border border-lt-hairline text-lt-fg2 hover:text-lt-fg'
            }`}
          >
            {t.label}
            <span className={`ml-2 text-xs ${tab === t.key ? 'text-white/80' : 'text-lt-fg3'}`}>
              {buckets[t.key].length}
            </span>
          </button>
        ))}
      </div>

      {/*
        The hand-off. Ticking rows and pressing one button is the whole
        interaction Wes asked for; what it cannot do is start a session on
        his laptop (HQ is on Vercel), so it queues the batch and hands him
        the brief — paste it, or run /improvements and it pulls the same thing.
      */}
      {list.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-lt-hairline bg-lt-card px-4 py-3">
          <label className="flex items-center gap-2 text-sm text-lt-fg2 cursor-pointer">
            <input
              type="checkbox"
              checked={allPicked}
              onChange={toggleAll}
              className="w-4 h-4 accent-amber-600 cursor-pointer"
            />
            Select all {list.length} shown
          </label>
          <div className="flex-1" />
          {picked.size > 0 && (
            <>
              <button
                type="button"
                onClick={() => setPicked(new Set())}
                className="text-xs font-semibold text-lt-fg3 hover:text-lt-fg"
              >
                Clear
              </button>
              {/* Closing the ones already done, without opening each row. */}
              <button
                type="button"
                onClick={() => bulkSet('FIXED')}
                disabled={handing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-xs font-semibold text-lt-fg2 hover:text-lt-fg disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                Mark {picked.size} fixed
              </button>
              <button
                type="button"
                onClick={() => bulkSet('WONT_FIX')}
                disabled={handing}
                className="rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-xs font-semibold text-lt-fg2 hover:text-lt-fg disabled:opacity-50"
              >
                Won&apos;t fix
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => handToClaude()}
            disabled={picked.size === 0 || handing}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-lt-inner disabled:text-lt-fg3 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white transition-colors"
          >
            <Wrench className="w-4 h-4" />
            {handing ? 'Handing over…' : `Hand to Claude${picked.size ? ` (${picked.size})` : ''}`}
          </button>
        </div>
      )}

      {brief && (
        <FixBriefPanel
          brief={brief}
          copied={copied}
          onCopy={async () => {
            try {
              await navigator.clipboard.writeText(brief.text)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            } catch {
              // Clipboard can be blocked; the textarea below is the fallback
              // and is already selectable.
            }
          }}
          onClose={() => setBrief(null)}
        />
      )}

      {list.length === 0 ? (
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-10 text-center">
          <Bug className="w-6 h-6 text-lt-fg3 mx-auto mb-2" />
          <p className="text-sm text-lt-fg2">
            {tab === 'todo' ? 'Nothing on the list. Enjoy it.' : 'Nothing here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((r) => {
            const expanded = open === r.id
            const people = 1 + r.duplicateCount
            return (
              <div key={r.id} className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
                <div className="flex items-start">
                  {/* Outside the expand button — a checkbox inside a button
                      is not clickable without swallowing the toggle. */}
                  <label className="pl-4 pt-[18px] shrink-0 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={picked.has(r.id)}
                      onChange={() => toggle(r.id)}
                      className="w-4 h-4 accent-amber-600 cursor-pointer"
                    />
                  </label>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : r.id)}
                  className="flex-1 min-w-0 text-left p-4 hover:bg-lt-inner/60 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {expanded ? (
                      <ChevronDown className="w-4 h-4 mt-1 shrink-0 text-lt-fg3" />
                    ) : (
                      <ChevronRight className="w-4 h-4 mt-1 shrink-0 text-lt-fg3" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SEVERITY_CHIP[r.severity]}`}>
                          {SEVERITY_LABEL[r.severity]}
                        </span>
                        <span className="text-[15px] font-semibold text-lt-fg">
                          {r.title || r.body.slice(0, 90)}
                        </span>
                      </div>
                      {/*
                        Separators are desktop-only. In a wrapping flex row a
                        trailing "·" strands itself at the end of every wrapped
                        line, which at phone width is most of them; the gap
                        alone reads fine there.
                      */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 sm:gap-x-3 gap-y-1 text-xs text-lt-fg3">
                        <span>{r.area || 'area unknown'}</span>
                        <span className="hidden sm:inline">·</span>
                        <span>{KIND_LABEL[r.kind]}</span>
                        <span className="hidden sm:inline">·</span>
                        <span>{r.reportedByName}</span>
                        <span className="hidden sm:inline">·</span>
                        <span>{fmt(r.createdAt)}</span>
                        {people > 1 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-chip-warn-bg px-2 py-0.5 font-semibold text-chip-warn-fg">
                            <Users className="w-3 h-3" />
                            {people} people
                          </span>
                        )}
                        {r.triageError && (
                          <span className="rounded-full bg-chip-bad-bg px-2 py-0.5 font-semibold text-chip-bad-fg">
                            triage failed
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CHIP[r.status]}`}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </div>
                </button>
                </div>

                {expanded && (
                  <div className="border-t border-lt-hairline p-4 space-y-4">
                    <Field label={`What ${r.reportedByName} wrote`}>
                      <p className="whitespace-pre-wrap text-[14px] text-lt-fg leading-relaxed">{r.body}</p>
                      <p className="mt-1.5 text-xs text-lt-fg3">
                        {r.reportedByEmail}
                        {r.reportedByRole ? ` · ${r.reportedByRole}` : ''}
                        {r.pagePath ? ` · from ${r.pagePath}` : ''}
                      </p>
                    </Field>

                    {r.alsoReportedBy.length > 0 && (
                      <Field label={`Also reported by ${r.alsoReportedBy.length} other${r.alsoReportedBy.length === 1 ? '' : 's'}`}>
                        <ul className="space-y-2">
                          {r.alsoReportedBy.map((d) => (
                            <li key={d.id} className="text-[13px] text-lt-fg2 leading-relaxed">
                              <span className="font-medium text-lt-fg">{d.name}</span>
                              <span className="text-lt-fg3"> · {fmt(d.createdAt)}</span>
                              <br />
                              {d.body}
                            </li>
                          ))}
                        </ul>
                      </Field>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${ROUTING_CHIP[r.routing]}`}>
                        {ROUTING_LABEL[r.routing]}
                      </span>
                      <span className="text-xs text-lt-fg3">{KIND_BLURB[r.kind]}</span>
                    </div>

                    {/*
                      The envelope. Shown ABOVE the agent's reasoning because
                      it is the only part nobody typed — it is what the
                      report would otherwise be missing, and it is what makes
                      "the send button didn't work" actionable.
                    */}
                    {r.context && <BrowserContext ctx={r.context} />}

                    {r.missingContext && (
                      <Field label="What the agent could not work out">{r.missingContext}</Field>
                    )}

                    {r.reasoning && <Field label="Why it was sorted this way">{r.reasoning}</Field>}
                    {r.response && (
                      <Field label={r.routing === 'ANSWERED' ? 'What the reporter was told' : 'What the agent thinks the fix is'}>
                        {r.response}
                      </Field>
                    )}
                    {r.suspects.length > 0 && (
                      <Field label="Where it might live">
                        <ul className="space-y-1">
                          {r.suspects.map((s) => (
                            <li key={s} className="font-mono text-[12px] text-lt-fg2">{s}</li>
                          ))}
                        </ul>
                      </Field>
                    )}
                    {r.triageError && (
                      <Field label="Triage failed">
                        <span className="text-chip-bad-fg">{r.triageError}</span>
                      </Field>
                    )}
                    {r.resolutionNote && <Field label="What was done">{r.resolutionNote}</Field>}

                    <div className="flex flex-wrap gap-2 pt-1">
                      {r.status !== 'IN_PROGRESS' && !['FIXED', 'WONT_FIX'].includes(r.status) && (
                        <Action onClick={() => patch(r.id, { status: 'IN_PROGRESS' })} busy={busy === r.id}>
                          Working on it
                        </Action>
                      )}
                      {!['FIXED'].includes(r.status) && (
                        <Action onClick={() => patch(r.id, { status: 'FIXED' })} busy={busy === r.id} primary>
                          <Check className="w-3.5 h-3.5" />
                          Fixed
                        </Action>
                      )}
                      {!['WONT_FIX'].includes(r.status) && (
                        <Action onClick={() => patch(r.id, { status: 'WONT_FIX' })} busy={busy === r.id}>
                          Won&apos;t fix
                        </Action>
                      )}
                      {['FIXED', 'WONT_FIX', 'ANSWERED'].includes(r.status) && (
                        <Action onClick={() => patch(r.id, { status: 'OPEN' })} busy={busy === r.id}>
                          Reopen
                        </Action>
                      )}
                      <Action onClick={() => patch(r.id, { retriage: true })} busy={busy === r.id}>
                        <RefreshCw className="w-3.5 h-3.5" />
                        Read it again
                      </Action>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * The work order, once a batch is handed over. Shown rather than silently
 * copied: Wes should see what is being sent, and the clipboard is not
 * reliable enough to be the only route (it is blocked in plenty of
 * contexts, and the textarea is the fallback).
 */
function FixBriefPanel({
  brief,
  copied,
  onCopy,
  onClose,
}: {
  brief: { batchId: string; count: number; text: string }
  copied: boolean
  onCopy: () => void
  onClose: () => void
}) {
  return (
    <div className="mb-4 rounded-xl border border-lt-hairline bg-lt-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-lt-fg">
            {brief.count} issue{brief.count === 1 ? '' : 's'} handed over
          </h2>
          <p className="mt-1 text-sm text-lt-fg2">
            They are marked <strong>Being fixed</strong> so nobody doubles up. Two ways to pick
            them up in Claude Code:
          </p>
          <ol className="mt-2 space-y-1 text-sm text-lt-fg2 list-decimal pl-5">
            <li>
              Run <code className="font-mono text-[13px] text-lt-fg">/improvements</code> — it pulls
              this batch itself, nothing to paste.
            </li>
            <li>Or copy the brief below and paste it in.</li>
          </ol>
          <p className="mt-2 text-sm text-lt-fg2">
            When it is done it closes the whole batch out at once, stamped with the commit —
            no going back through them one by one.
          </p>
          <p className="mt-2 text-xs text-lt-fg3">
            Batch <span className="font-mono">{brief.batchId}</span>
          </p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-lt-fg3 hover:text-lt-fg" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <textarea
        readOnly
        value={brief.text}
        rows={10}
        onFocus={(e) => e.currentTarget.select()}
        className="mt-3 w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 font-mono text-[12px] leading-relaxed text-lt-fg"
      />
      <button
        type="button"
        onClick={onCopy}
        className="mt-2 inline-flex items-center gap-2 rounded-lg bg-lt-inner border border-lt-hairline px-3 py-2 text-xs font-semibold text-lt-fg2 hover:text-lt-fg"
      >
        {copied ? <ClipboardCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? 'Copied' : 'Copy the brief'}
      </button>
    </div>
  )
}

/**
 * What the browser saw, captured automatically. The failed requests are
 * the valuable part — a status and a route turn a vague report into a
 * place to look — so they lead, and the walked-through pages follow
 * because the page BEFORE /guides is where it actually happened.
 */
function BrowserContext({ ctx }: { ctx: BugContext }) {
  const pages = ctx.pages?.map((p) => p.path) ?? []
  const failed = ctx.failedRequests ?? []
  const errors = ctx.errors ?? []
  // Looked up server-side at submit time (resolveContext.ts) and stashed
  // alongside the envelope, so the board never re-queries.
  const resolved = (ctx as BugContext & { resolved?: { label: string }[] }).resolved ?? []
  if (!pages.length && !failed.length && !errors.length && !resolved.length) return null

  return (
    <div className="rounded-lg bg-lt-inner p-3">
      <div className="text-[11px] uppercase font-semibold tracking-[1.4px] text-lt-fg3 mb-2">
        What the browser saw
      </div>

      {failed.length > 0 && (
        <div className="mb-2">
          <div className="text-[12px] text-lt-fg2 mb-1">Requests that failed</div>
          <ul className="space-y-0.5">
            {failed.map((f, i) => (
              <li key={i} className="font-mono text-[12px] text-lt-fg">
                <span className="text-chip-bad-fg">{f.status === 0 ? 'never completed' : f.status}</span>{' '}
                {f.method} {f.url}
              </li>
            ))}
          </ul>
        </div>
      )}

      {errors.length > 0 && (
        <div className="mb-2">
          <div className="text-[12px] text-lt-fg2 mb-1">Errors thrown</div>
          <ul className="space-y-0.5">
            {errors.map((e, i) => (
              <li key={i} className="font-mono text-[12px] text-chip-bad-fg">{e.message}</li>
            ))}
          </ul>
        </div>
      )}

      {resolved.length > 0 && (
        <div className="mb-2">
          <div className="text-[12px] text-lt-fg2 mb-1">Which records those were</div>
          <ul className="space-y-0.5">
            {resolved.map((e, i) => (
              <li key={i} className="text-[13px] font-medium text-lt-fg">{e.label}</li>
            ))}
          </ul>
        </div>
      )}

      {pages.length > 0 && (
        <div className="text-[12px] text-lt-fg2">
          Pages: <span className="font-mono text-lt-fg">{pages.join(' → ')}</span>
        </div>
      )}

      {failed.length === 0 && errors.length === 0 && (
        <div className="text-[12px] text-lt-fg3">
          Nothing failed in the last few minutes — if a click should have sent something, the
          handler probably never fired.
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase font-semibold tracking-[1.4px] text-lt-fg3 mb-1.5">{label}</div>
      <div className="text-[14px] text-lt-fg2 leading-relaxed">{children}</div>
    </div>
  )
}

function Action({
  children,
  onClick,
  busy,
  primary,
}: {
  children: React.ReactNode
  onClick: () => void
  busy: boolean
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
        primary
          ? 'bg-amber-600 hover:bg-amber-500 text-white'
          : 'bg-lt-inner border border-lt-hairline text-lt-fg2 hover:text-lt-fg'
      }`}
    >
      {children}
    </button>
  )
}
