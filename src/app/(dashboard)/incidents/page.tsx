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

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ClaimMailTriage } from '@/components/claims/ClaimMailTriage'
import {
  SeverityControl,
  DriverInline,
  NextActionRow,
  RecoveryStepper,
  type DerivedSeverity,
  type RecoveryPosture,
} from '@/components/incidents/IncidentCardControls'

type IncidentSource = 'EMAIL' | 'RETURN_INSPECTION' | 'MANUAL'
type IncidentStatus = 'OPEN' | 'CLAIM_FILED' | 'BILLED_RENTER' | 'RESOLVED' | 'WRITTEN_OFF'

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
