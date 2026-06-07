'use client'

/**
 * Insurance Claims dashboard. Real-data replacement for the prior
 * 494-line mock that hand-rolled a Claim[] with synthetic rows.
 *
 * Reads /api/claims with the canonical ClaimStatus enum (DRAFT,
 * READY_TO_SEND, SUBMITTED, ACKNOWLEDGED, NEGOTIATING, SETTLED,
 * DENIED, ESCALATED, CLOSED). Status chips below filter the list
 * server-side; "Open" excludes the three terminal states.
 *
 * Click a row → /claims/[id] (detail page with editable fields +
 * timeline). Schema-required pieces (booking + asset + company)
 * mean manual create is a form not a one-click — that flow lives
 * on the detail page's create surface; this list focuses on the
 * triage view.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NewClaimModal } from '@/components/claims/NewClaimModal'
import { ClaimMailTriage } from '@/components/claims/ClaimMailTriage'
import type { ClaimBadge } from '@/lib/claims/claimBadges'

type ClaimStatus =
  | 'DRAFT' | 'READY_TO_SEND' | 'SUBMITTED' | 'ACKNOWLEDGED'
  | 'NEGOTIATING' | 'SETTLED' | 'DENIED' | 'ESCALATED' | 'CLOSED'

interface ClaimRow {
  id: string
  claimNumber: string
  status: ClaimStatus
  filedAgainst: string
  adjusterName: string | null
  adjusterEmail: string | null
  policyNumber: string | null
  carrierClaimNumber: string | null
  incidentDate: string
  incidentDescription: string
  repairEstimate: number | null
  repairActual: number | null
  totalDemand: number | null
  amountOffered: number | null
  amountSettled: number | null
  submittedAt: string | null
  settledAt: string | null
  createdAt: string
  updatedAt: string
  company: { id: string; name: string }
  asset: {
    id: string; unitName: string
    year: number | null; make: string | null; model: string | null
    category: { name: string } | null
  } | null
  assignedToUser: { id: string; name: string } | null
  invoice: { id: string; invoiceNumber: string; type: string; total: number } | null
  _count: { timeline: number; documents: number; damageItems: number }
  // Phase A — server-computed badge facts + client exposure + severity.
  badges: ClaimBadge[]
  severity: number
  clientExposure: number | null
}

// Light tokens already in the palette (chip / cadence / chip-bad).
// Severity escalates neutral → warn → bad. No new colors.
const BADGE_TONE: Record<ClaimBadge, string> = {
  ESCALATED:          'bg-chip-bad-bg text-chip-bad-fg',
  OVERDUE_RESPONSE:   'bg-chip-bad-bg text-chip-bad-fg',
  LD_INVOICE_OVERDUE: 'bg-chip-bad-bg text-chip-bad-fg',
  HIGH_EXPOSURE:      'bg-chip-warn-bg text-chip-warn-fg',
  GONE_QUIET:         'bg-chip-warn-bg text-chip-warn-fg',
  STALE_NEGOTIATING:  'bg-chip-warn-bg text-chip-warn-fg',
  FROM_EMAIL_REVIEW:  'bg-chip-warn-bg text-chip-warn-fg',
  MISSING_COI:        'bg-chip-neutral-bg text-chip-neutral-fg',
}
const BADGE_LABEL: Record<ClaimBadge, string> = {
  ESCALATED:          'Escalated',
  OVERDUE_RESPONSE:   'Overdue',
  LD_INVOICE_OVERDUE: 'LD past-due',
  HIGH_EXPOSURE:      'High exposure',
  GONE_QUIET:         'Quiet',
  STALE_NEGOTIATING:  'Stale',
  FROM_EMAIL_REVIEW:  'From email — review',
  MISSING_COI:        'No COI',
}

function BadgeChips({ badges }: { badges: ClaimBadge[] }) {
  if (badges.length === 0) return null
  return (
    <div className="flex items-center gap-1 flex-wrap mt-1">
      {badges.map((b) => (
        <span
          key={b}
          className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${BADGE_TONE[b]}`}
        >
          {BADGE_LABEL[b]}
        </span>
      ))}
    </div>
  )
}

// Single-character mapping so all 9 enum values fit cleanly on a
// chip without wrapping. Tones use the light-theme chip tokens that
// the rest of the app uses (chip-good/warn/bad/neutral + a couple
// of cadence colors). No new palette introduced.
const STATUS_TONE: Record<ClaimStatus, string> = {
  DRAFT:         'bg-chip-neutral-bg text-chip-neutral-fg',
  READY_TO_SEND: 'bg-cadence-booked-bg text-cadence-booked-fg',
  SUBMITTED:     'bg-cadence-on-rental-bg text-cadence-on-rental-fg',
  ACKNOWLEDGED:  'bg-cadence-on-rental-bg text-cadence-on-rental-fg',
  NEGOTIATING:   'bg-chip-warn-bg text-chip-warn-fg',
  SETTLED:       'bg-chip-good-bg text-chip-good-fg',
  CLOSED:        'bg-chip-neutral-bg text-chip-neutral-fg',
  DENIED:        'bg-chip-bad-bg text-chip-bad-fg',
  ESCALATED:     'bg-chip-bad-bg text-chip-bad-fg',
}
const STATUS_LABEL: Record<ClaimStatus, string> = {
  DRAFT:         'Draft',
  READY_TO_SEND: 'Ready to send',
  SUBMITTED:     'Submitted',
  ACKNOWLEDGED:  'Acknowledged',
  NEGOTIATING:   'Negotiating',
  SETTLED:       'Settled',
  DENIED:        'Denied',
  ESCALATED:     'Escalated',
  CLOSED:        'Closed',
}

const fmtMoney = (n: number | null): string => {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
const fmtDate = (iso: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

type FilterKey = 'open' | 'all' | ClaimStatus
const FILTER_CHIPS: { key: FilterKey; label: string }[] = [
  { key: 'open',         label: 'Open' },
  { key: 'all',          label: 'All' },
  { key: 'DRAFT',        label: 'Draft' },
  { key: 'SUBMITTED',    label: 'Submitted' },
  { key: 'NEGOTIATING',  label: 'Negotiating' },
  { key: 'SETTLED',      label: 'Settled' },
  { key: 'DENIED',       label: 'Denied' },
  { key: 'ESCALATED',    label: 'Escalated' },
]

export default function ClaimsPage() {
  const router = useRouter()
  const [filter, setFilter] = useState<FilterKey>('open')
  const [claims, setClaims] = useState<ClaimRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [prefillClaimMailId, setPrefillClaimMailId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const params = new URLSearchParams()
    if (filter === 'open') params.set('open', '1')
    else if (filter !== 'all') params.set('status', filter)
    try {
      const res = await fetch(`/api/claims?${params.toString()}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error || `HTTP ${res.status}`)
        return
      }
      const data = await res.json()
      setClaims(data.claims || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load claims')
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  // Rollups — render in a small header strip so a triager sees the
  // financial picture without opening each claim. Sums use only the
  // currently-filtered rows so the totals match what's visible.
  const totals = useMemo(() => {
    if (!claims) return { count: 0, demand: 0, offered: 0, settled: 0 }
    return claims.reduce(
      (acc, c) => ({
        count: acc.count + 1,
        demand: acc.demand + (c.totalDemand ?? 0),
        offered: acc.offered + (c.amountOffered ?? 0),
        settled: acc.settled + (c.amountSettled ?? 0),
      }),
      { count: 0, demand: 0, offered: 0, settled: 0 },
    )
  }, [claims])

  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1400px] mx-auto">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-lt-fg">Insurance claims</h1>
            <p className="text-sm text-lt-fg2 mt-1">
              {claims == null ? 'Loading…' : `${totals.count} claim${totals.count === 1 ? '' : 's'}`}
              {claims != null && totals.count > 0 && (
                <>
                  {' · demand '}<span className="font-mono">{fmtMoney(totals.demand)}</span>
                  {' · offered '}<span className="font-mono">{fmtMoney(totals.offered)}</span>
                  {' · settled '}<span className="font-mono">{fmtMoney(totals.settled)}</span>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="px-4 py-2 bg-lt-fg hover:bg-black text-white text-sm font-medium rounded-lg transition-colors"
          >
            + New claim
          </button>
        </div>

        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          {FILTER_CHIPS.map((c) => {
            const active = filter === c.key
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setFilter(c.key)}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                  active
                    ? 'bg-lt-fg border-lt-fg text-white'
                    : 'bg-lt-card border-lt-hairline text-lt-fg2 hover:border-lt-fg2'
                }`}
              >
                {c.label}
              </button>
            )
          })}
        </div>

        {error && (
          <div className="rounded-lg border border-chip-bad-fg/30 bg-chip-bad-bg/30 text-chip-bad-fg text-sm px-4 py-2 mb-4">
            {error}
          </div>
        )}

        <ClaimMailTriage
          onOpenPrefill={(id) => { setPrefillClaimMailId(id); setShowNew(true) }}
        />

        {showNew && (
          <NewClaimModal
            onClose={() => { setShowNew(false); setPrefillClaimMailId(null) }}
            prefillFromClaimMailId={prefillClaimMailId ?? undefined}
          />
        )}

        <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-lt-hairline text-lt-fg2 text-left text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Claim</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Carrier</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Asset</th>
                <th className="px-4 py-3 font-medium">Incident</th>
                <th className="px-4 py-3 font-medium text-right">Demand</th>
                <th className="px-4 py-3 font-medium text-right">Settled</th>
                <th className="px-4 py-3 font-medium">Assignee</th>
              </tr>
            </thead>
            <tbody>
              {claims == null ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-lt-fg3">Loading…</td></tr>
              ) : claims.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-lt-fg3">No claims in this view.</td></tr>
              ) : claims.map((c) => {
                // Left-accent treatment for attention-needing rows.
                // The neutral→warn→bad escalation mirrors the chip
                // tone palette — no new colors.
                const accent =
                  c.severity >= 50 ? 'border-l-4 border-l-chip-bad-fg' :
                  c.severity >= 20 ? 'border-l-4 border-l-chip-warn-fg' :
                  'border-l-4 border-l-transparent'
                return (
                <tr
                  key={c.id}
                  onClick={() => router.push(`/claims/${c.id}`)}
                  className={`border-b border-lt-hairline/50 hover:bg-lt-inner/60 cursor-pointer transition-colors ${accent}`}
                >
                  <td className="px-4 py-3 align-top">
                    <div className="font-mono text-xs text-lt-fg font-semibold">{c.claimNumber}</div>
                    {c.invoice && (
                      <div className="text-[11px] text-lt-fg3 mt-0.5">
                        inv {c.invoice.invoiceNumber}
                      </div>
                    )}
                    <BadgeChips badges={c.badges} />
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${STATUS_TONE[c.status]}`}>
                      {STATUS_LABEL[c.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="text-xs text-lt-fg">{c.filedAgainst}</div>
                    {c.carrierClaimNumber && (
                      <div className="text-[11px] text-lt-fg2 font-mono mt-0.5" title="Carrier's own claim number">
                        # {c.carrierClaimNumber}
                      </div>
                    )}
                    {c.adjusterName && (
                      <div className="text-[11px] text-lt-fg3 mt-0.5">{c.adjusterName}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-lt-fg2">{c.company.name}</td>
                  <td className="px-4 py-3 align-top">
                    {c.asset ? (
                      <>
                        <div className="text-xs text-lt-fg">{c.asset.unitName}</div>
                        <div className="text-[11px] text-lt-fg3 mt-0.5">
                          {[c.asset.year, c.asset.make, c.asset.model].filter(Boolean).join(' ')}
                          {c.asset.category?.name ? ` · ${c.asset.category.name}` : ''}
                        </div>
                      </>
                    ) : (
                      <span className="text-lt-fg3 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-lt-fg2 whitespace-nowrap">
                    {fmtDate(c.incidentDate)}
                  </td>
                  <td className="px-4 py-3 align-top text-right text-xs font-mono text-lt-fg">
                    {fmtMoney(c.totalDemand)}
                  </td>
                  <td className="px-4 py-3 align-top text-right text-xs font-mono text-lt-fg">
                    {fmtMoney(c.amountSettled)}
                  </td>
                  <td className="px-4 py-3 align-top text-xs">
                    {c.assignedToUser
                      ? <span className="text-lt-fg2">{c.assignedToUser.name}</span>
                      : <span className="text-lt-fg3">Unassigned</span>}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
