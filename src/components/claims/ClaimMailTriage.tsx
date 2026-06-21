'use client'

/**
 * Triage widget for inbound claims@ mail. Sits above the /claims list
 * and shows every claims@ email's onboarding disposition.
 *
 *   DRAFTED       — neutral/good chip. Click-through to the claim.
 *   ATTACHED      — neutral/good chip. Click-through to the claim.
 *   NEEDS_REVIEW  — warn chip. Renders parsed client + one-line loss
 *                   summary. "Create claim" pre-fills the modal from
 *                   the stored parse; "Dismiss" stamps the reviewer
 *                   and hides the row.
 *   IGNORED       — muted chip. Manual "Create claim" still available
 *                   in case the classifier missed.
 *
 * Reads /api/claims/mail-triage. Dismiss PATCHes the row endpoint.
 * "Create claim" tells the parent to open NewClaimModal with the
 * ClaimMail id, which streams the parse into the form.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { computeDerivedSeverity, type DerivedSeverity } from '@/lib/incidents/derive'

type Disposition = 'DRAFTED' | 'ATTACHED' | 'NEEDS_REVIEW' | 'IGNORED'

interface ParseShape {
  clientCompanyName: string | null
  carrierName: string | null
  carrierClaimNumber: string | null
  lossDescription: string | null
  statusGuess: string | null
}

interface ClaimMailRow {
  id: string
  disposition: Disposition
  parse: ParseShape | null
  claimId: string | null
  reason: string | null
  dismissed: boolean
  reviewedAt: string | null
  createdAt: string
  emailMessage: {
    id: string
    fromAddress: string
    subject: string
    sentAt: string
    snippet: string | null
    attachmentCount: number
  }
  claim: { id: string; claimNumber: string; status: string; filedAgainst: string } | null
  // Phase Incidents — when set, the widget renders "View incident
  // SR-INC-NNNN" instead of the action button. Both manual "Open
  // incident report" clicks and the DRAFTED auto-create path populate
  // this (and STEP 2 of the UX follow-up — thread-level link — back-
  // fills sibling rows on the same Gmail thread).
  incidentId: string | null
  incident: { id: string; incidentNumber: string; status: string } | null
}

const CHIP: Record<Disposition, string> = {
  DRAFTED:      'bg-chip-good-bg text-chip-good-fg',
  ATTACHED:     'bg-chip-neutral-bg text-chip-neutral-fg',
  NEEDS_REVIEW: 'bg-chip-warn-bg text-chip-warn-fg',
  IGNORED:      'bg-lt-inner text-lt-fg3',
}
const LABEL: Record<Disposition, string> = {
  DRAFTED:      'Drafted',
  ATTACHED:     'Attached',
  NEEDS_REVIEW: 'Needs review',
  IGNORED:      'Ignored',
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const diffMin = (now - d.getTime()) / 60_000
  if (diffMin < 60) return `${Math.floor(diffMin)}m ago`
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function trim(s: string | null | undefined, n: number): string {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}

export function ClaimMailTriage({ onIncidentOpened }: {
  // Phase Incidents — replaces the prior onOpenPrefill prop. The widget
  // no longer opens NewClaimModal directly; instead it POSTs the
  // open-incident action and refreshes. Parent can pass this callback
  // to route the user to the new incident's detail page (STEP 4) or
  // just trigger an outer reload.
  onIncidentOpened?: (incidentId: string, incidentNumber: string) => void
}) {
  const [rows, setRows] = useState<ClaimMailRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  // Per-row pending state for the open-incident POST.
  const [pendingId, setPendingId] = useState<string | null>(null)
  // Per-row "just opened" cache so the action click can render an
  // SR-INC-NNNN Link immediately, without waiting for the refresh
  // round-trip to populate row.incident. Keys are ClaimMail.id;
  // values carry both id (for the link target) and incidentNumber
  // (for the label).
  const [lastOpened, setLastOpened] = useState<{ [claimMailId: string]: { id: string; incidentNumber: string } }>({})

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/claims/mail-triage')
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d?.error || `HTTP ${res.status}`)
        return
      }
      const data = await res.json()
      setRows((data.rows ?? []) as ClaimMailRow[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const dismiss = async (id: string) => {
    const before = rows
    setRows((rs) => rs?.filter((r) => r.id !== id) ?? null)
    try {
      const res = await fetch(`/api/claims/mail-triage/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismiss: true }),
      })
      if (!res.ok) {
        setRows(before)
        setError('dismiss failed')
      }
    } catch {
      setRows(before)
      setError('dismiss failed')
    }
  }

  // Phase 1 grouping: split rows by whether they already point at an
  // Incident (server-confirmed `r.incident`). Folded by incident in
  // section 1; flat triage queue in section 2.
  //
  // `lastOpened` (the optimistic just-clicked cache) is deliberately
  // NOT used for splitting — a row stays in the unassigned section
  // through one render cycle so the user sees their "View SR-INC-NNNN"
  // feedback inline, then the next `load()` refresh folds it into the
  // right group via the server-confirmed `r.incident`.
  const { incidentGroups, unassigned } = useMemo(() => {
    const groups = new Map<string, IncidentGroup>()
    const unassigned: ClaimMailRow[] = []
    if (!rows) return { incidentGroups: [] as IncidentGroup[], unassigned }
    for (const r of rows) {
      if (r.incident?.id) {
        const key = r.incident.id
        const existing = groups.get(key)
        if (existing) {
          existing.rows.push(r)
        } else {
          groups.set(key, {
            id: r.incident.id,
            incidentNumber: r.incident.incidentNumber,
            incidentStatus: r.incident.status,
            rows: [r],
          })
        }
      } else {
        unassigned.push(r)
      }
    }
    // Sort groups by latest mail activity (newest first). Use the row
    // createdAt as the activity signal — that's when HQ landed it.
    const incidentGroups = Array.from(groups.values()).map((g) => {
      const latestMs = Math.max(...g.rows.map((r) => new Date(r.createdAt).getTime()))
      const totalAttachments = g.rows.reduce((s, r) => s + (r.emailMessage.attachmentCount || 0), 0)
      return { ...g, latestMs, totalAttachments }
    })
    incidentGroups.sort((a, b) => b.latestMs - a.latestMs)
    return { incidentGroups, unassigned }
  }, [rows])

  if (rows == null) {
    return (
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 mb-6 text-sm text-lt-fg2">
        Loading claim mail…
      </div>
    )
  }
  if (rows.length === 0) return null

  // Build the per-row action wiring once so both sections share it
  // (and TriageRow stays a pure presentational component).
  const onRowOpenIncident = (rowId: string) => async () => {
    setPendingId(rowId)
    setError(null)
    try {
      const res = await fetch(`/api/claims/mail-triage/${rowId}/open-incident`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.incident) {
        setError(data?.error || `HTTP ${res.status}`)
        return
      }
      setLastOpened((m) => ({
        ...m,
        [rowId]: { id: data.incident.incidentId, incidentNumber: data.incident.incidentNumber },
      }))
      onIncidentOpened?.(data.incident.incidentId, data.incident.incidentNumber)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'open-incident failed')
    } finally {
      setPendingId(null)
    }
  }

  const messageCount = rows.length
  const groupCount = incidentGroups.length
  const unassignedCount = unassigned.length

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl mb-6">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-lt-inner transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-lt-fg">Claim mail</span>
          <span className="text-xs text-lt-fg2">
            {groupCount > 0 && (
              <>
                {groupCount} {groupCount === 1 ? 'incident' : 'incidents'}
                {unassignedCount > 0 ? ' · ' : ''}
              </>
            )}
            {unassignedCount > 0 && (
              <span className={unassignedCount > 0 ? 'text-chip-warn-fg font-medium' : undefined}>
                {unassignedCount} unassigned message{unassignedCount === 1 ? '' : 's'}
              </span>
            )}
            {groupCount === 0 && unassignedCount === 0 && (
              <>{messageCount} {messageCount === 1 ? 'message' : 'messages'}</>
            )}
          </span>
        </div>
        <span className="text-xs text-lt-fg2">{collapsed ? 'Expand' : 'Collapse'}</span>
      </button>

      {!collapsed && (
        <div className="border-t border-lt-hairline">
          {error && (
            <div className="px-4 py-2 text-xs text-chip-bad-fg bg-chip-bad-bg/30">{error}</div>
          )}

          {/* Section 1 — grouped by incident */}
          {incidentGroups.length > 0 && (
            <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold">
              By incident
            </div>
          )}
          {incidentGroups.map((g) => (
            <IncidentGroupCard
              key={g.id}
              group={g}
              pendingId={pendingId}
              lastOpened={lastOpened}
              onOpenIncident={onRowOpenIncident}
              onDismiss={dismiss}
            />
          ))}

          {/* Section 2 — unassigned (the real triage queue) */}
          {unassigned.length > 0 && (
            <div className={`px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold ${incidentGroups.length > 0 ? 'border-t border-lt-hairline mt-1' : ''}`}>
              Needs an incident
            </div>
          )}
          {unassigned.length > 0 && (
            <div className="divide-y divide-lt-hairline">
              {unassigned.map((r) => (
                <TriageRow
                  key={r.id}
                  row={r}
                  pending={pendingId === r.id}
                  justOpened={lastOpened[r.id] ?? null}
                  onOpenIncident={onRowOpenIncident(r.id)}
                  onDismiss={() => dismiss(r.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface IncidentGroup {
  id: string
  incidentNumber: string
  incidentStatus: string
  rows: ClaimMailRow[]
  latestMs?: number
  totalAttachments?: number
}

// Status-pill tone mirrors /incidents/page.tsx so the widget looks
// like the rest of the surface without importing across modules.
const INCIDENT_STATUS_TONE: Record<string, string> = {
  OPEN:          'bg-chip-warn-bg text-chip-warn-fg',
  CLAIM_FILED:   'bg-chip-neutral-bg text-chip-neutral-fg',
  BILLED_RENTER: 'bg-chip-neutral-bg text-chip-neutral-fg',
  RESOLVED:      'bg-chip-good-bg text-chip-good-fg',
  WRITTEN_OFF:   'bg-lt-inner text-lt-fg3',
}
const INCIDENT_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open', CLAIM_FILED: 'Claim filed', BILLED_RENTER: 'Billed renter',
  RESOLVED: 'Resolved', WRITTEN_OFF: 'Written off',
}

function fmtGroupDate(ms: number): string {
  const d = new Date(ms)
  const diffMin = (Date.now() - ms) / 60_000
  if (diffMin < 60) return `${Math.floor(diffMin)}m ago`
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function IncidentGroupCard({
  group,
  pendingId,
  lastOpened,
  onOpenIncident,
  onDismiss,
}: {
  group: IncidentGroup
  pendingId: string | null
  lastOpened: { [k: string]: { id: string; incidentNumber: string } }
  onOpenIncident: (rowId: string) => () => void
  onDismiss: (rowId: string) => void
}) {
  // Collapsed-by-default per spec. Per-card expand state lives here so
  // each card opens independently; the outer widget toggle still hides
  // the whole list at once.
  const [expanded, setExpanded] = useState(false)
  const tone = INCIDENT_STATUS_TONE[group.incidentStatus] ?? 'bg-lt-inner text-lt-fg2'
  const label = INCIDENT_STATUS_LABEL[group.incidentStatus] ?? group.incidentStatus
  const n = group.rows.length
  // Severity is derived client-side here from the same pure helper
  // the /api/incidents endpoint uses server-side — keeps the chip in
  // sync between the triage widget and the Incidents list card.
  const severity: DerivedSeverity = computeDerivedSeverity(
    group.rows.map((r) => ({ parse: r.parse, emailMessage: { fromAddress: r.emailMessage.fromAddress } })),
  )
  const isLitigation = severity === 'LITIGATION'
  return (
    <div className="border-t border-lt-hairline first:border-t-0">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-lt-fg3 hover:text-lt-fg2 w-4 text-center shrink-0"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <Link
          href={`/incidents/${group.id}`}
          className="text-xs font-mono font-semibold text-lt-fg hover:underline underline-offset-2"
        >
          {group.incidentNumber}
        </Link>
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${tone}`}>
          {label}
        </span>
        {isLitigation && (
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-chip-bad-bg text-chip-bad-fg"
            title="Derived from inbound mail: law-firm sender or litigation phrase in parse."
          >
            ⚠ Litigation
          </span>
        )}
        <span className="text-xs text-lt-fg2">
          {n} {n === 1 ? 'message' : 'messages'}
          {group.latestMs != null && <> · latest {fmtGroupDate(group.latestMs)}</>}
          {group.totalAttachments != null && group.totalAttachments > 0 && (
            <> · {group.totalAttachments} attachment{group.totalAttachments === 1 ? '' : 's'}</>
          )}
        </span>
      </div>
      {expanded && (
        <div className="divide-y divide-lt-hairline border-t border-lt-hairline bg-lt-inner/20">
          {group.rows.map((r) => (
            <TriageRow
              key={r.id}
              row={r}
              pending={pendingId === r.id}
              justOpened={lastOpened[r.id] ?? null}
              onOpenIncident={onOpenIncident(r.id)}
              onDismiss={() => onDismiss(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TriageRow({ row, pending, justOpened, onOpenIncident, onDismiss }: {
  row: ClaimMailRow
  pending: boolean
  justOpened: { id: string; incidentNumber: string } | null
  onOpenIncident: () => void
  onDismiss: () => void
}) {
  const { disposition, parse, claim, emailMessage: em } = row
  const isLinked = disposition === 'DRAFTED' || disposition === 'ATTACHED'
  const needsReview = disposition === 'NEEDS_REVIEW'
  const muted = disposition === 'IGNORED'

  return (
    <div className={`flex items-start gap-3 px-4 py-3 ${muted ? 'opacity-70' : ''}`}>
      <span
        className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded mt-0.5 whitespace-nowrap ${CHIP[disposition]}`}
      >
        {LABEL[disposition]}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-medium text-lt-fg truncate">
            {trim(em.subject, 100)}
          </span>
          <span className="text-xs text-lt-fg3">
            from {trim(em.fromAddress, 60)} · {fmtTime(em.sentAt)}
          </span>
          {em.attachmentCount > 0 && (
            <span className="text-xs text-lt-fg3">· {em.attachmentCount} attachment{em.attachmentCount === 1 ? '' : 's'}</span>
          )}
        </div>
        {needsReview && parse && (
          <div className="mt-1 text-xs text-lt-fg2">
            {parse.clientCompanyName && (
              <span>
                <span className="text-lt-fg3">Client:</span>{' '}
                <span className="font-medium text-lt-fg">{parse.clientCompanyName}</span>
              </span>
            )}
            {parse.clientCompanyName && parse.lossDescription && <span> · </span>}
            {parse.lossDescription && (
              <span className="text-lt-fg2">{trim(parse.lossDescription, 200)}</span>
            )}
          </div>
        )}
        {isLinked && claim && (
          <div className="mt-1 text-xs">
            <a
              href={`/claims/${claim.id}`}
              className="text-lt-fg2 hover:text-lt-fg underline-offset-2 hover:underline"
            >
              {claim.claimNumber} · {claim.status} · {claim.filedAgainst}
            </a>
          </div>
        )}
        {row.reason && !isLinked && (
          <div className="mt-1 text-[11px] text-lt-fg3 italic">{row.reason}</div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* Precedence: persisted incident link (from prior session OR
            thread-level back-link from a sibling row) → just-opened
            chip (this session) → action button. All three render as
            an SR-INC-NNNN link to /incidents/[id] except the action
            button which fires the POST + flips to the persisted state
            on success. */}
        {row.incident ? (
          <Link
            href={`/incidents/${row.incident.id}`}
            className="text-xs px-2.5 py-1 rounded border border-chip-good-fg/30 bg-chip-good-bg text-chip-good-fg hover:bg-chip-good-fg hover:text-white font-mono transition-colors"
            title="Open the incident"
          >
            View {row.incident.incidentNumber}
          </Link>
        ) : justOpened ? (
          <Link
            href={`/incidents/${justOpened.id}`}
            className="text-xs px-2.5 py-1 rounded border border-chip-good-fg/30 bg-chip-good-bg text-chip-good-fg hover:bg-chip-good-fg hover:text-white font-mono transition-colors"
          >
            View {justOpened.incidentNumber}
          </Link>
        ) : (needsReview || muted) && (
          <button
            type="button"
            onClick={onOpenIncident}
            disabled={pending}
            className="text-xs px-2.5 py-1 rounded border border-lt-fg/30 bg-lt-card hover:bg-lt-fg hover:text-white text-lt-fg transition-colors disabled:opacity-50"
          >
            {pending ? 'Opening…' : 'Open incident report'}
          </button>
        )}
        {!isLinked && !justOpened && !row.incident && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs px-2 py-1 rounded text-lt-fg3 hover:text-lt-fg2 hover:bg-lt-inner transition-colors"
            title="Dismiss"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  )
}
