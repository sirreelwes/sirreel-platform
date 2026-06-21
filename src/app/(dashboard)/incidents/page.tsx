'use client'

/**
 * Unified Incidents tab. Replaces /claims as the top-level nav entry.
 * Three views:
 *
 *   - Incidents (default): the new hub list
 *   - Claims:    legacy claims dashboard, badge views intact
 *   - Triage:    the existing claim-mail widget docked at top of both
 *                (always visible above the active list)
 *
 * The /claims route redirects here. /claims/[id] keeps resolving against
 * the existing claim detail page; /incidents/[id] is a new incident
 * detail page that cross-links to claims when ones exist.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ClaimMailTriage } from '@/components/claims/ClaimMailTriage'

type IncidentSource = 'EMAIL' | 'RETURN_INSPECTION' | 'MANUAL'
type IncidentStatus = 'OPEN' | 'CLAIM_FILED' | 'BILLED_RENTER' | 'RESOLVED' | 'WRITTEN_OFF'

type DerivedSeverity = 'LITIGATION' | 'ROUTINE'
type RecoveryPosture =
  | 'carrier_not_started'
  | 'carrier_live'
  | 'billing_renter'
  | 'closed'

interface IncidentRow {
  id: string
  incidentNumber: string
  source: IncidentSource
  status: IncidentStatus
  description: string
  occurredAt: string | null
  createdAt: string
  updatedAt: string
  company: { id: string; name: string } | null
  order: { id: string; orderNumber: string } | null
  asset: { id: string; unitName: string } | null
  _count: { claims: number; damageItems: number; documents: number }
  // Phase 2 enrichment from /api/incidents
  firstClaim: {
    id: string
    claimNumber: string
    filedAgainst: string
    carrierClaimNumber: string | null
    status: string
  } | null
  derivedSeverity: DerivedSeverity
  recoveryPosture: RecoveryPosture
  suggestedNextAction: string
  messageCount: number
  totalAttachments: number
  latestActivityAt: string
  // Phase 3 worklist fields
  severity: DerivedSeverity | null         // stored override (null = auto)
  effectiveSeverity: DerivedSeverity        // stored ?? derived
  assigneeId: string | null
  assignee: { id: string; name: string } | null
  nextAction: string | null
  nextActionDueAt: string | null
  driverName: string | null
}

interface AssignableUser {
  id: string
  name: string
  role: string
}

interface ClaimRow {
  id: string
  claimNumber: string
  status: string
  filedAgainst: string
  carrierClaimNumber: string | null
  company: { name: string } | null
  incidentDate: string
  createdAt: string
}

const STATUS_TONE: Record<IncidentStatus, string> = {
  OPEN:          'bg-chip-warn-bg text-chip-warn-fg',
  CLAIM_FILED:   'bg-chip-neutral-bg text-chip-neutral-fg',
  BILLED_RENTER: 'bg-chip-neutral-bg text-chip-neutral-fg',
  RESOLVED:      'bg-chip-good-bg text-chip-good-fg',
  WRITTEN_OFF:   'bg-lt-inner text-lt-fg3',
}
const STATUS_LABEL: Record<IncidentStatus, string> = {
  OPEN: 'Open', CLAIM_FILED: 'Claim filed', BILLED_RENTER: 'Billed renter',
  RESOLVED: 'Resolved', WRITTEN_OFF: 'Written off',
}
const SOURCE_LABEL: Record<IncidentSource, string> = {
  EMAIL: 'Email', RETURN_INSPECTION: 'Return inspection', MANUAL: 'Manual',
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function IncidentsPage() {
  const router = useRouter()
  const sp = useSearchParams()
  const view = (sp?.get('view') === 'claims' ? 'claims' : 'incidents') as 'incidents' | 'claims'

  const [incidents, setIncidents] = useState<IncidentRow[] | null>(null)
  const [claims, setClaims] = useState<ClaimRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | 'ALL'>('ALL')
  const [showNew, setShowNew] = useState(false)
  // Assignable users — lazy-loaded once per session for the per-card
  // assignee pickers. Endpoint is cheap (<20 staff users) so no
  // pagination / caching layer needed.
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/incidents/assignable-users', { cache: 'no-store' })
        if (!r.ok) return
        const j = await r.json()
        if (!cancelled) setAssignableUsers(j.users ?? [])
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      if (view === 'incidents') {
        const url = statusFilter === 'ALL'
          ? '/api/incidents'
          : `/api/incidents?status=${statusFilter}`
        const res = await fetch(url)
        if (!res.ok) { setError(`HTTP ${res.status}`); return }
        const data = await res.json()
        setIncidents(data.incidents ?? [])
      } else {
        const res = await fetch('/api/claims?open=1')
        if (!res.ok) { setError(`HTTP ${res.status}`); return }
        const data = await res.json()
        setClaims(data.claims ?? [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load')
    }
  }, [view, statusFilter])

  useEffect(() => { load() }, [load])

  const incidentCount = incidents?.length ?? 0
  const claimCount = claims?.length ?? 0

  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1400px] mx-auto space-y-4">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-lt-fg">Incidents</h1>
            <p className="text-sm text-lt-fg2 mt-1">
              Recovery paths in preference order: carrier claim → bill renter → absorb.
            </p>
          </div>
          {view === 'incidents' && (
            <button
              type="button"
              onClick={() => setShowNew(true)}
              className="px-4 py-2 bg-lt-fg hover:bg-black text-white text-sm font-medium rounded-lg transition-colors"
            >
              + New incident
            </button>
          )}
        </div>

        {/* Claim-mail triage widget docked at top of both views */}
        <ClaimMailTriage onIncidentOpened={() => load()} />

        {/* View switcher — Incidents first, Claims second. Adjacent
            tab pattern matches /crm's People/Companies switch. */}
        <div className="flex gap-1 bg-lt-inner rounded-lg p-0.5 w-fit">
          {([
            ['incidents', 'Incidents', incidentCount],
            ['claims', 'Claims', claimCount],
          ] as const).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => router.replace(key === 'incidents' ? '/incidents' : '/incidents?view=claims')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                view === key ? 'bg-white text-lt-fg' : 'text-lt-fg2 hover:text-lt-fg'
              }`}
            >
              {label} <span className="font-mono text-xs ml-1 text-lt-fg3">{count}</span>
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-lg border border-chip-bad-fg/30 bg-chip-bad-bg/30 text-chip-bad-fg text-sm px-4 py-2">
            {error}
          </div>
        )}

        {view === 'incidents' ? (
          <IncidentsList
            rows={incidents}
            statusFilter={statusFilter}
            onFilter={setStatusFilter}
            assignableUsers={assignableUsers}
            onChanged={load}
          />
        ) : (
          <ClaimsListLink rows={claims} />
        )}

        {showNew && <NewIncidentModal onClose={() => { setShowNew(false); load() }} />}
      </div>
    </div>
  )
}

// ── Incidents list ─────────────────────────────────────────────────

function IncidentsList({
  rows, statusFilter, onFilter, assignableUsers, onChanged,
}: {
  rows: IncidentRow[] | null
  statusFilter: IncidentStatus | 'ALL'
  onFilter: (s: IncidentStatus | 'ALL') => void
  assignableUsers: AssignableUser[]
  onChanged: () => void | Promise<void>
}) {
  const filterChips: Array<IncidentStatus | 'ALL'> = ['ALL', 'OPEN', 'CLAIM_FILED', 'BILLED_RENTER', 'RESOLVED', 'WRITTEN_OFF']

  // Phase 3 sort — 3-level tuple key:
  //   1. effective LITIGATION first
  //   2. then incidents with an overdue nextActionDueAt
  //   3. then latest activity desc
  // Re-sort client-side so chip filters apply without a refetch.
  const nowMs = Date.now()
  const sortedRows = rows
    ? [...rows].sort((a, b) => {
        const aLit = a.effectiveSeverity === 'LITIGATION' ? 0 : 1
        const bLit = b.effectiveSeverity === 'LITIGATION' ? 0 : 1
        if (aLit !== bLit) return aLit - bLit
        const aOverdue = a.nextActionDueAt && new Date(a.nextActionDueAt).getTime() < nowMs ? 0 : 1
        const bOverdue = b.nextActionDueAt && new Date(b.nextActionDueAt).getTime() < nowMs ? 0 : 1
        if (aOverdue !== bOverdue) return aOverdue - bOverdue
        const aMs = new Date(a.latestActivityAt).getTime()
        const bMs = new Date(b.latestActivityAt).getTime()
        return bMs - aMs
      })
    : null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {filterChips.map((s) => (
          <button
            key={s}
            onClick={() => onFilter(s)}
            className={`px-2 py-0.5 rounded-full border ${
              statusFilter === s
                ? 'bg-lt-fg border-lt-fg text-white'
                : 'bg-lt-card border-lt-hairline text-lt-fg2 hover:border-lt-fg2'
            }`}
          >
            {s === 'ALL' ? 'All' : STATUS_LABEL[s as IncidentStatus]}
          </button>
        ))}
      </div>

      {sortedRows == null ? (
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 text-sm text-lt-fg2">Loading…</div>
      ) : sortedRows.length === 0 ? (
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 text-sm text-lt-fg2">
          No incidents in this filter. Use the claim-mail triage above to open one from an inbound email, or click + New incident.
        </div>
      ) : (
        <div className="space-y-2">
          {sortedRows.map((r) => (
            <IncidentCard key={r.id} r={r} assignableUsers={assignableUsers} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Decision-first incident card ──────────────────────────────────
//
// One card per Incident. Stack order:
//   - Header: SR-INC link · status pill · severity chip · "N msgs"
//   - Identity line: vehicle · loss date · client (driver lands when
//     it's modeled on Incident; see Phase 3 brief).
//   - Recovery stepper: Carrier → Renter → Absorbed, current step
//     highlighted from recoveryPosture. Closed states render the
//     whole stepper at 60% with a "Closed" pill instead of a current
//     step.
//   - Suggested next action: one-line advisory (LITIGATION-toned when
//     severity demands it).
//   - Key facts: claim # + carrier (if any child claim) · company link.

function IncidentCard({
  r, assignableUsers, onChanged,
}: {
  r: IncidentRow
  assignableUsers: AssignableUser[]
  onChanged: () => void | Promise<void>
}) {
  const isLitigation = r.effectiveSeverity === 'LITIGATION'
  const isClosed = r.recoveryPosture === 'closed'
  const isOverdue = r.nextActionDueAt
    ? new Date(r.nextActionDueAt).getTime() < Date.now()
    : false
  const dueSoon = r.nextActionDueAt
    ? !isOverdue && (new Date(r.nextActionDueAt).getTime() - Date.now()) < 48 * 3_600_000
    : false

  // Inline PATCH helper — shared by every editable affordance on the
  // card. On success → onChanged() re-fetches the list; on 403 the
  // shared error chip will surface the gate message.
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const patch = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/incidents/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(json?.error || `HTTP ${res.status}`); return false }
      await onChanged()
      return true
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'patch failed')
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`bg-lt-card border rounded-xl p-4 transition-colors ${
        isLitigation ? 'border-chip-bad-fg/40' : 'border-lt-hairline'
      }`}
    >
      {/* Header row — only the SR-INC # is a Link now, so inline
          controls don't compete with row navigation. */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <Link
          href={`/incidents/${r.id}`}
          className="font-mono text-xs font-semibold text-lt-fg hover:underline underline-offset-2"
        >
          {r.incidentNumber}
        </Link>
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${STATUS_TONE[r.status]}`}>
          {STATUS_LABEL[r.status]}
        </span>
        <SeverityControl
          effective={r.effectiveSeverity}
          stored={r.severity}
          busy={busy}
          onSet={(next) => patch({ severity: next })}
        />
        <span className="text-[11px] text-lt-fg3">
          {r.messageCount > 0 ? `${r.messageCount} msg${r.messageCount === 1 ? '' : 's'}` : 'no mail'}
          {r.totalAttachments > 0 && ` · ${r.totalAttachments} attachment${r.totalAttachments === 1 ? '' : 's'}`}
        </span>
        <span className="text-[11px] text-lt-fg3 ml-auto">
          latest {fmtDate(r.latestActivityAt)}
        </span>
      </div>

      {/* Identity line — driver editable inline. */}
      <div className="text-sm text-lt-fg2 mb-2 flex items-center gap-1 flex-wrap">
        <span className="font-medium text-lt-fg">{r.asset?.unitName ?? 'No vehicle'}</span>
        <span className="text-lt-fg3">· loss {fmtDate(r.occurredAt)}</span>
        <span className="text-lt-fg3">·</span>
        <DriverInline value={r.driverName} busy={busy} onSave={(v) => patch({ driverName: v })} />
        <span className="text-lt-fg3">·</span>
        {r.company ? (
          <span className="text-lt-fg">{r.company.name}</span>
        ) : (
          <span className="italic text-chip-warn-fg">not in CRM</span>
        )}
        {r.order && (
          <span className="text-lt-fg3 font-mono">· {r.order.orderNumber}</span>
        )}
        <span className="text-lt-fg3 text-xs">· {SOURCE_LABEL[r.source]}</span>
      </div>

      {/* Recovery stepper */}
      <RecoveryStepper posture={r.recoveryPosture} className="mb-2" />

      {/* Next action — stored takes precedence over derived suggestion. */}
      <NextActionRow
        storedAction={r.nextAction}
        storedDueAt={r.nextActionDueAt}
        derivedSuggestion={r.suggestedNextAction}
        isLitigation={isLitigation}
        isOverdue={isOverdue}
        dueSoon={dueSoon}
        busy={busy}
        onSave={(action, dueAt) => patch({ nextAction: action, nextActionDueAt: dueAt })}
        onClear={() => patch({ nextAction: null, nextActionDueAt: null })}
      />

      {/* Assignee picker — single-select; rendered as the lower-left
          "Owner:" affordance so the worklist's "who has this" question
          is one glance. */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-lt-fg3 mt-2 pt-2 border-t border-lt-hairline/60">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider font-semibold">Owner</span>
          <select
            value={r.assigneeId ?? ''}
            onChange={(e) => { void patch({ assigneeId: e.target.value || null }) }}
            disabled={busy}
            className="text-xs bg-transparent border border-lt-hairline rounded px-1.5 py-0.5 text-lt-fg2 hover:border-lt-fg2"
          >
            <option value="">unassigned</option>
            {assignableUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>

        {/* Key facts — child claim (if any) + counts */}
        {r.firstClaim ? (
          <span>
            <span className="text-lt-fg2 font-mono">{r.firstClaim.claimNumber}</span>
            <span className="text-lt-fg3"> · {r.firstClaim.filedAgainst}</span>
            {r.firstClaim.carrierClaimNumber && (
              <span className="text-lt-fg3 font-mono"> · carrier #{r.firstClaim.carrierClaimNumber}</span>
            )}
          </span>
        ) : (
          <span className="text-lt-fg3 italic">no claim filed</span>
        )}
        {r._count.damageItems > 0 && <span>damage items {r._count.damageItems}</span>}
        {r._count.documents > 0 && <span>docs {r._count.documents}</span>}
        {isClosed && (
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-lt-inner text-lt-fg3">
            Closed
          </span>
        )}
      </div>

      {err && (
        <div className="mt-2 text-[11px] text-chip-bad-fg bg-chip-bad-bg/30 rounded px-2 py-1">
          {err}
        </div>
      )}
    </div>
  )
}

// Severity control — effective chip + escalate/de-escalate buttons +
// "auto" tag when there's no stored override. Mousing over the chip
// shows where the value came from. The Routine/Litigation toggle is
// always available; "clear override" only when an override exists.
function SeverityControl({
  effective, stored, busy, onSet,
}: {
  effective: DerivedSeverity
  stored: DerivedSeverity | null
  busy: boolean
  onSet: (next: DerivedSeverity | null) => void | Promise<unknown>
}) {
  const isOverride = stored !== null
  const isLit = effective === 'LITIGATION'
  const baseChip = isLit
    ? 'bg-chip-bad-bg text-chip-bad-fg'
    : 'bg-chip-neutral-bg text-chip-neutral-fg'
  const tooltip = isOverride
    ? `Override: ${stored}. Click to clear and fall back to auto.`
    : `Auto-derived from linked mail. Click to escalate or de-escalate.`
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${baseChip}`}
        title={tooltip}
      >
        {isLit ? '⚠ Litigation' : 'Routine'}
      </span>
      {!isOverride && (
        <span
          className="text-[9px] uppercase tracking-wider text-lt-fg3 font-semibold"
          title="No stored override. Effective severity comes from the heuristic."
        >
          auto
        </span>
      )}
      {/* Toggle to the OTHER severity — single button, asymmetric label */}
      <button
        type="button"
        disabled={busy}
        onClick={() => onSet(isLit ? 'ROUTINE' : 'LITIGATION')}
        className="text-[10px] text-lt-fg3 hover:text-lt-fg2 disabled:opacity-40"
        title={isLit ? 'De-escalate to Routine' : 'Escalate to Litigation'}
      >
        {isLit ? '↓ routine' : '↑ litigation'}
      </button>
      {isOverride && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onSet(null)}
          className="text-[10px] text-lt-fg3 hover:text-lt-fg2 disabled:opacity-40"
          title="Clear override — fall back to auto"
        >
          × clear
        </button>
      )}
    </span>
  )
}

// Inline driver editor — click to reveal text input, save on blur or
// Enter, cancel on Escape. Empty input clears the value.
function DriverInline({
  value, busy, onSave,
}: {
  value: string | null
  busy: boolean
  onSave: (v: string | null) => void | Promise<unknown>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value])
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        disabled={busy}
        className={`text-xs disabled:opacity-50 ${value ? 'text-lt-fg' : 'italic text-chip-warn-fg'}`}
        title="Click to edit driver"
      >
        {value ? `driver ${value}` : 'driver unknown'}
      </button>
    )
  }
  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed === (value ?? '')) { setEditing(false); return }
    void Promise.resolve(onSave(trimmed || null)).then(() => setEditing(false))
  }
  return (
    <input
      autoFocus
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) }
      }}
      disabled={busy}
      placeholder="driver name"
      className="text-xs bg-transparent border-b border-lt-hairline focus:border-lt-fg outline-none px-1 text-lt-fg w-40"
    />
  )
}

// Next-action row — when stored set, render it verbatim with a
// "owned" label, due-date pill (overdue → bad-fg, due-soon → warn-fg).
// When stored empty, render the derived suggestion as a "Suggested:"
// prompt with a small "set action" affordance to open the editor.
function NextActionRow({
  storedAction, storedDueAt, derivedSuggestion,
  isLitigation, isOverdue, dueSoon, busy, onSave, onClear,
}: {
  storedAction: string | null
  storedDueAt: string | null
  derivedSuggestion: string
  isLitigation: boolean
  isOverdue: boolean
  dueSoon: boolean
  busy: boolean
  onSave: (action: string, dueAt: string | null) => void | Promise<unknown>
  onClear: () => void | Promise<unknown>
}) {
  const [editing, setEditing] = useState(false)
  const [actionDraft, setActionDraft] = useState(storedAction ?? '')
  const [dueDraft, setDueDraft] = useState(storedDueAt ? storedDueAt.slice(0, 10) : '')
  useEffect(() => {
    setActionDraft(storedAction ?? '')
    setDueDraft(storedDueAt ? storedDueAt.slice(0, 10) : '')
  }, [storedAction, storedDueAt])

  if (editing) {
    return (
      <div className="mb-2 flex items-center gap-2 flex-wrap">
        <input
          type="text"
          autoFocus
          value={actionDraft}
          onChange={(e) => setActionDraft(e.target.value)}
          placeholder="e.g. file LD invoice with carrier"
          className="flex-1 min-w-[200px] text-sm border border-lt-hairline rounded px-2 py-1 text-lt-fg"
        />
        <input
          type="date"
          value={dueDraft}
          onChange={(e) => setDueDraft(e.target.value)}
          className="text-sm border border-lt-hairline rounded px-2 py-1 text-lt-fg"
        />
        <button
          type="button"
          disabled={busy || !actionDraft.trim()}
          onClick={async () => {
            await onSave(actionDraft.trim(), dueDraft || null)
            setEditing(false)
          }}
          className="text-xs font-semibold bg-lt-fg text-white px-2.5 py-1 rounded disabled:opacity-40"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            setActionDraft(storedAction ?? '')
            setDueDraft(storedDueAt ? storedDueAt.slice(0, 10) : '')
            setEditing(false)
          }}
          className="text-xs text-lt-fg3 hover:text-lt-fg2"
        >
          Cancel
        </button>
      </div>
    )
  }

  if (storedAction) {
    const dueTone = isOverdue
      ? 'bg-chip-bad-bg text-chip-bad-fg'
      : dueSoon
        ? 'bg-chip-warn-bg text-chip-warn-fg'
        : 'bg-lt-inner text-lt-fg3'
    return (
      <div className="mb-2 flex items-center gap-2 flex-wrap text-sm">
        <span className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold">Next</span>
        <span className="text-lt-fg font-medium">{storedAction}</span>
        {storedDueAt && (
          <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${dueTone}`}>
            {isOverdue ? 'overdue ' : 'due '}
            {fmtDate(storedDueAt)}
          </span>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={busy}
          className="text-[11px] text-lt-fg3 hover:text-lt-fg2 disabled:opacity-40"
        >
          edit
        </button>
        <button
          type="button"
          onClick={() => onClear()}
          disabled={busy}
          className="text-[11px] text-lt-fg3 hover:text-chip-bad-fg disabled:opacity-40"
        >
          clear
        </button>
      </div>
    )
  }

  // No stored action — show derived suggestion as a prompt.
  return (
    <div className={`mb-2 flex items-center gap-2 flex-wrap text-sm ${isLitigation ? 'text-chip-bad-fg font-medium' : 'text-lt-fg2'}`}>
      <span className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold">Suggested</span>
      <span>{derivedSuggestion}</span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        disabled={busy}
        className="text-[11px] text-lt-fg3 hover:text-lt-fg2 disabled:opacity-40"
      >
        set action…
      </button>
    </div>
  )
}

// Three-step recovery ladder. Step state:
//   done    → fully colored, checkmark, the step is in the rear-view
//   current → fully colored, no check, the step the rep is on now
//   pending → muted, no fill, the next-or-later step
// closed posture: all three render muted with a "Closed" indicator
// outside this component (the card surfaces it under key facts).
function RecoveryStepper({
  posture,
  className,
}: {
  posture: RecoveryPosture
  className?: string
}) {
  const steps = ['Carrier claim', 'Bill renter', 'Absorb'] as const
  const currentIndex = posture === 'carrier_not_started' ? -1
    : posture === 'carrier_live' ? 0
    : posture === 'billing_renter' ? 1
    : 2
  const closed = posture === 'closed'
  return (
    <div className={`flex items-center gap-1 ${className ?? ''}`}>
      {steps.map((label, i) => {
        const isCurrent = !closed && i === currentIndex
        const isDone = !closed && i < currentIndex
        const cls = closed
          ? 'bg-lt-inner border-lt-hairline text-lt-fg3'
          : isCurrent
            ? 'bg-amber-500/15 border-amber-500/40 text-amber-700 font-semibold'
            : isDone
              ? 'bg-chip-good-bg border-chip-good-fg/30 text-chip-good-fg'
              : 'bg-transparent border-lt-hairline text-lt-fg3'
        return (
          <span key={label} className="flex items-center gap-1">
            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${cls}`}>
              {isDone && <span className="mr-1" aria-hidden>✓</span>}
              {label}
            </span>
            {i < steps.length - 1 && (
              <span className="text-lt-fg3 text-xs" aria-hidden>→</span>
            )}
          </span>
        )
      })}
    </div>
  )
}

// ── Claims view (legacy embed via link list) ──────────────────────

function ClaimsListLink({ rows }: { rows: ClaimRow[] | null }) {
  if (rows == null) {
    return <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 text-sm text-lt-fg2">Loading…</div>
  }
  if (rows.length === 0) {
    return (
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 text-sm text-lt-fg2">
        No open claims. New claims now originate from Incidents — open an incident first, then upgrade.
      </div>
    )
  }
  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-lt-hairline text-lt-fg3 text-left text-xs uppercase tracking-wide">
            <th className="px-4 py-3 font-medium">Claim</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Carrier</th>
            <th className="px-4 py-3 font-medium">Carrier #</th>
            <th className="px-4 py-3 font-medium">Client</th>
            <th className="px-4 py-3 font-medium">Incident date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-lt-hairline/50 hover:bg-lt-inner/40">
              <td className="px-4 py-3">
                <Link href={`/claims/${c.id}`} className="text-lt-fg hover:text-black hover:underline font-mono text-xs">
                  {c.claimNumber}
                </Link>
              </td>
              <td className="px-4 py-3 text-lt-fg2 text-xs">{c.status}</td>
              <td className="px-4 py-3 text-lt-fg2">{c.filedAgainst}</td>
              <td className="px-4 py-3 text-lt-fg3 font-mono text-xs">{c.carrierClaimNumber ?? '—'}</td>
              <td className="px-4 py-3 text-lt-fg2">{c.company?.name ?? '—'}</td>
              <td className="px-4 py-3 text-lt-fg3 text-xs">{fmtDate(c.incidentDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Manual new-incident modal ─────────────────────────────────────

function NewIncidentModal({ onClose }: { onClose: () => void }) {
  const [description, setDescription] = useState('')
  const [occurredAt, setOccurredAt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (description.trim().length < 10) { setError('Description must be at least 10 characters'); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/incidents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim(), occurredAt: occurredAt || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data?.error || `HTTP ${res.status}`); setSubmitting(false); return }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center pt-20">
      <div className="bg-lt-card rounded-xl w-full max-w-md p-6 space-y-3 shadow-xl">
        <h2 className="text-lg font-semibold text-lt-fg">New incident</h2>
        <p className="text-xs text-lt-fg3">
          Capture what happened. Order/asset/company linking happens on the incident detail page once it exists.
        </p>
        <label className="block">
          <span className="text-xs text-lt-fg2">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="e.g. Cracked windshield reported on return — driver hit gravel on I-405."
            className="w-full mt-1 px-2 py-1.5 border border-lt-hairline rounded text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-lt-fg2">Occurred on (optional)</span>
          <input
            type="date" value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="mt-1 px-2 py-1 border border-lt-hairline rounded text-sm"
          />
        </label>
        {error && <div className="text-xs text-chip-bad-fg">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-xs text-lt-fg2 hover:text-lt-fg px-3 py-1.5">Cancel</button>
          <button
            onClick={submit} disabled={submitting}
            className="text-xs bg-lt-fg text-white px-3 py-1.5 rounded disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create incident'}
          </button>
        </div>
      </div>
    </div>
  )
}
