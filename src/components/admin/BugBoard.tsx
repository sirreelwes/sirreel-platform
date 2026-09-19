'use client'

/**
 * The to-do list on /admin/bugs.
 *
 * Every hook is above every early return — the repo has no ESLint, so
 * rules-of-hooks never runs (project_no_eslint_hooks_gap).
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, Bug, Check, ChevronDown, ChevronRight, RefreshCw, Users } from 'lucide-react'
import type { BugKind, BugRouting, BugSeverity, BugStatus } from '@prisma/client'
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

  const list = buckets[tab]

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
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : r.id)}
                  className="w-full text-left p-4 hover:bg-lt-inner/60 transition-colors"
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
