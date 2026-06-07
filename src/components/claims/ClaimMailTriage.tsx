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

export function ClaimMailTriage({ onOpenPrefill }: {
  onOpenPrefill: (claimMailId: string) => void
}) {
  const [rows, setRows] = useState<ClaimMailRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

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

  const counts = useMemo(() => {
    if (!rows) return null
    const c: Record<Disposition, number> = { DRAFTED: 0, ATTACHED: 0, NEEDS_REVIEW: 0, IGNORED: 0 }
    for (const r of rows) c[r.disposition]++
    return c
  }, [rows])

  if (rows == null) {
    return (
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 mb-6 text-sm text-lt-fg2">
        Loading claim mail…
      </div>
    )
  }
  if (rows.length === 0) return null

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
            {rows.length} {rows.length === 1 ? 'message' : 'messages'}
            {counts && counts.NEEDS_REVIEW > 0 && (
              <>
                {' · '}
                <span className="text-chip-warn-fg font-medium">
                  {counts.NEEDS_REVIEW} need{counts.NEEDS_REVIEW === 1 ? 's' : ''} review
                </span>
              </>
            )}
          </span>
        </div>
        <span className="text-xs text-lt-fg2">{collapsed ? 'Expand' : 'Collapse'}</span>
      </button>

      {!collapsed && (
        <div className="border-t border-lt-hairline divide-y divide-lt-hairline">
          {error && (
            <div className="px-4 py-2 text-xs text-chip-bad-fg bg-chip-bad-bg/30">{error}</div>
          )}
          {rows.map((r) => (
            <TriageRow
              key={r.id}
              row={r}
              onCreate={() => onOpenPrefill(r.id)}
              onDismiss={() => dismiss(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TriageRow({ row, onCreate, onDismiss }: {
  row: ClaimMailRow
  onCreate: () => void
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
        {(needsReview || muted) && (
          <button
            type="button"
            onClick={onCreate}
            className="text-xs px-2.5 py-1 rounded border border-lt-fg/30 bg-lt-card hover:bg-lt-fg hover:text-white text-lt-fg transition-colors"
          >
            Create claim
          </button>
        )}
        {!isLinked && (
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
