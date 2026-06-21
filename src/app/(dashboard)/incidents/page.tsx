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
  rows, statusFilter, onFilter,
}: {
  rows: IncidentRow[] | null
  statusFilter: IncidentStatus | 'ALL'
  onFilter: (s: IncidentStatus | 'ALL') => void
}) {
  const filterChips: Array<IncidentStatus | 'ALL'> = ['ALL', 'OPEN', 'CLAIM_FILED', 'BILLED_RENTER', 'RESOLVED', 'WRITTEN_OFF']

  // Phase 2 sort: LITIGATION rises to the top regardless of activity;
  // within each severity bucket, newest activity first. The server
  // already ordered by createdAt desc — we re-sort client-side so the
  // severity bubble-up is visible immediately on page-level filter
  // changes without a refetch.
  const sortedRows = rows
    ? [...rows].sort((a, b) => {
        const aLit = a.derivedSeverity === 'LITIGATION' ? 0 : 1
        const bLit = b.derivedSeverity === 'LITIGATION' ? 0 : 1
        if (aLit !== bLit) return aLit - bLit
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
            <IncidentCard key={r.id} r={r} />
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

function IncidentCard({ r }: { r: IncidentRow }) {
  const isLitigation = r.derivedSeverity === 'LITIGATION'
  const isClosed = r.recoveryPosture === 'closed'
  return (
    <Link
      href={`/incidents/${r.id}`}
      className={`block bg-lt-card border rounded-xl p-4 hover:bg-lt-inner/40 transition-colors ${
        isLitigation ? 'border-chip-bad-fg/40' : 'border-lt-hairline'
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="font-mono text-xs font-semibold text-lt-fg">{r.incidentNumber}</span>
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${STATUS_TONE[r.status]}`}>
          {STATUS_LABEL[r.status]}
        </span>
        <SeverityChip severity={r.derivedSeverity} />
        <span className="text-[11px] text-lt-fg3">
          {r.messageCount > 0 ? `${r.messageCount} msg${r.messageCount === 1 ? '' : 's'}` : 'no mail'}
          {r.totalAttachments > 0 && ` · ${r.totalAttachments} attachment${r.totalAttachments === 1 ? '' : 's'}`}
        </span>
        <span className="text-[11px] text-lt-fg3 ml-auto">
          latest {fmtDate(r.latestActivityAt)}
        </span>
      </div>

      {/* Identity line */}
      <div className="text-sm text-lt-fg2 mb-2">
        <span className="font-medium text-lt-fg">
          {r.asset?.unitName ?? 'No vehicle'}
        </span>
        <span className="text-lt-fg3"> · loss {fmtDate(r.occurredAt)}</span>
        <span className="text-lt-fg3"> · </span>
        {r.company ? (
          <span className="text-lt-fg">{r.company.name}</span>
        ) : (
          <span className="italic text-chip-warn-fg">not in CRM</span>
        )}
        {r.order && (
          <span className="text-lt-fg3 font-mono"> · {r.order.orderNumber}</span>
        )}
        <span className="text-lt-fg3 text-xs"> · {SOURCE_LABEL[r.source]}</span>
      </div>

      {/* Recovery stepper */}
      <RecoveryStepper posture={r.recoveryPosture} className="mb-2" />

      {/* Suggested next action */}
      <div className={`text-sm mb-2 ${isLitigation ? 'text-chip-bad-fg font-medium' : 'text-lt-fg2'}`}>
        <span className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold mr-1.5">Suggested</span>
        {r.suggestedNextAction}
      </div>

      {/* Key facts — child claim (if any) + counts */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-lt-fg3 pt-2 border-t border-lt-hairline/60">
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
        {r._count.damageItems > 0 && (
          <span>damage items {r._count.damageItems}</span>
        )}
        {r._count.documents > 0 && (
          <span>docs {r._count.documents}</span>
        )}
        {isClosed && (
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-lt-inner text-lt-fg3">
            Closed
          </span>
        )}
      </div>
    </Link>
  )
}

function SeverityChip({ severity }: { severity: DerivedSeverity }) {
  if (severity === 'LITIGATION') {
    return (
      <span
        className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-chip-bad-bg text-chip-bad-fg"
        title="Derived from inbound mail: law-firm sender or litigation phrase in parse. Phase 3 will let you override."
      >
        ⚠ Litigation
      </span>
    )
  }
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-chip-neutral-bg text-chip-neutral-fg"
      title="Derived — no litigation signal in linked mail."
    >
      Routine
    </span>
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
