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

interface IncidentRow {
  id: string
  incidentNumber: string
  source: IncidentSource
  status: IncidentStatus
  description: string
  occurredAt: string | null
  createdAt: string
  company: { id: string; name: string } | null
  order: { id: string; orderNumber: string } | null
  asset: { id: string; unitName: string } | null
  _count: { claims: number; damageItems: number; documents: number }
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

      {rows == null ? (
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 text-sm text-lt-fg2">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 text-sm text-lt-fg2">
          No incidents in this filter. Use the claim-mail triage above to open one from an inbound email, or click + New incident.
        </div>
      ) : (
        <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-lt-hairline text-lt-fg3 text-left text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Incident</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Occurred</th>
                <th className="px-4 py-3 font-medium text-right">Claims</th>
                <th className="px-4 py-3 font-medium text-right">Damages</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-lt-hairline/50 hover:bg-lt-inner/40">
                  <td className="px-4 py-3">
                    <Link href={`/incidents/${r.id}`} className="text-lt-fg hover:text-black hover:underline font-mono text-xs">
                      {r.incidentNumber}
                    </Link>
                    <div className="text-xs text-lt-fg3 truncate max-w-[400px]">{r.description.slice(0, 100)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${STATUS_TONE[r.status]}`}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-lt-fg2 text-xs">{SOURCE_LABEL[r.source]}</td>
                  <td className="px-4 py-3 text-lt-fg2">{r.company?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-lt-fg2 font-mono text-xs">{r.order?.orderNumber ?? '—'}</td>
                  <td className="px-4 py-3 text-lt-fg3 text-xs">{fmtDate(r.occurredAt)}</td>
                  <td className="px-4 py-3 text-right text-lt-fg2 font-mono">{r._count.claims}</td>
                  <td className="px-4 py-3 text-right text-lt-fg2 font-mono">{r._count.damageItems}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
