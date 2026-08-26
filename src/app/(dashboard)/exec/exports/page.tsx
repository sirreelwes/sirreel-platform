'use client'

/**
 * /exec/exports — Wes's data-export approval queue.
 *
 * The human end of the rule (2026-08-26): nobody exports SirReel's
 * proprietary data without his say-so. Non-approvers who reach this URL see
 * their own request history instead of the queue — the API already scopes
 * the rows, so this is presentation, not the access control.
 *
 * Pending requests sort first and oldest-first: an export someone is waiting
 * on shouldn't be buried under settled history.
 */

import { useCallback, useEffect, useState } from 'react'

type Status = 'PENDING' | 'APPROVED' | 'DENIED' | 'FULFILLED' | 'EXPIRED'

interface ExportRequest {
  id: string
  kind: string
  status: Status
  reason: string
  scopeLabel: string
  rowCountAtRequest: number | null
  rowCountDelivered: number | null
  requestedAt: string
  decidedAt: string | null
  decisionNote: string | null
  expiresAt: string | null
  downloadCount: number
  lastDownloadedAt: string | null
  requestedBy: { id: string; name: string; email: string }
  decidedBy: { id: string; name: string; email: string } | null
  canDownload: boolean
}

const STATUS_TONE: Record<Status, string> = {
  PENDING: 'bg-amber-100 text-amber-900 border-amber-300',
  APPROVED: 'bg-green-100 text-green-900 border-green-300',
  FULFILLED: 'bg-lt-inner text-lt-fg border-lt-hairline',
  DENIED: 'bg-red-100 text-red-900 border-red-300',
  EXPIRED: 'bg-lt-inner text-lt-muted border-lt-hairline',
}

function when(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default function ExportApprovalsPage() {
  const [rows, setRows] = useState<ExportRequest[] | null>(null)
  const [isApprover, setIsApprover] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [noteFor, setNoteFor] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/exports/requests')
      if (!res.ok) {
        setError(res.status === 403 ? 'You do not have access to exports.' : 'Could not load requests.')
        setRows([])
        return
      }
      const data = await res.json()
      setIsApprover(!!data.isApprover)
      setRows(data.requests || [])
      setError(null)
    } catch {
      setError('Could not load requests.')
      setRows([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const decide = async (id: string, decision: 'APPROVE' | 'DENY') => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/exports/requests/${id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: noteFor[id] || undefined }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d?.error || 'Could not record the decision.')
      } else {
        await load()
      }
    } finally {
      setBusyId(null)
    }
  }

  const pending = (rows || []).filter((r) => r.status === 'PENDING')
  const settled = (rows || []).filter((r) => r.status !== 'PENDING')

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-2xl font-semibold text-lt-fg mb-1">
        {isApprover ? 'Data export approvals' : 'My export requests'}
      </h1>
      <p className="text-sm text-lt-muted mb-6">
        {isApprover
          ? 'Exports of SirReel client data require your approval. Approved exports stay downloadable for a limited window, then expire.'
          : 'Exports of SirReel client data require approval from Wes. Approved exports stay downloadable for a limited window.'}
      </p>

      {error && (
        <div className="mb-4 text-sm bg-red-50 border border-red-200 text-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      {rows === null ? (
        <div className="text-sm text-lt-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-lt-muted border border-lt-hairline rounded-lg px-4 py-8 text-center">
          No export requests.
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-lt-fg mb-2">
                Awaiting decision ({pending.length})
              </h2>
              <div className="space-y-3">
                {pending.map((r) => (
                  <Row
                    key={r.id} r={r} isApprover={isApprover} busy={busyId === r.id}
                    note={noteFor[r.id] || ''}
                    onNote={(v) => setNoteFor((m) => ({ ...m, [r.id]: v }))}
                    onDecide={decide}
                  />
                ))}
              </div>
            </section>
          )}
          {settled.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-lt-fg mb-2">History</h2>
              <div className="space-y-3">
                {settled.map((r) => (
                  <Row
                    key={r.id} r={r} isApprover={isApprover} busy={false}
                    note="" onNote={() => {}} onDecide={decide}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function Row({
  r, isApprover, busy, note, onNote, onDecide,
}: {
  r: ExportRequest
  isApprover: boolean
  busy: boolean
  note: string
  onNote: (v: string) => void
  onDecide: (id: string, d: 'APPROVE' | 'DENY') => void
}) {
  return (
    <div className="border border-lt-hairline rounded-lg bg-lt-card px-4 py-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-lt-fg">
              {r.requestedBy.name}
            </span>
            <span className="text-xs text-lt-muted">{r.requestedBy.email}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_TONE[r.status]}`}>
              {r.status}
            </span>
          </div>
          <div className="text-xs text-lt-muted mt-1">
            Client list · {r.scopeLabel} · {r.rowCountAtRequest ?? '?'} rows ·
            requested {when(r.requestedAt)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {r.canDownload && (
            <a
              href={`/api/exports/requests/${r.id}/download`}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg"
            >
              Download CSV
            </a>
          )}
        </div>
      </div>

      <div className="mt-2 text-sm text-lt-fg bg-lt-inner border border-lt-hairline rounded px-3 py-2">
        {r.reason}
      </div>

      {(r.decidedAt || r.downloadCount > 0) && (
        <div className="mt-2 text-xs text-lt-muted space-y-0.5">
          {r.decidedAt && (
            <div>
              {r.status === 'DENIED' ? 'Denied' : 'Approved'} by{' '}
              {r.decidedBy?.name ?? 'unknown'} · {when(r.decidedAt)}
              {r.expiresAt && r.status !== 'DENIED' && ` · window ends ${when(r.expiresAt)}`}
            </div>
          )}
          {r.decisionNote && <div>Note: {r.decisionNote}</div>}
          {r.downloadCount > 0 && (
            <div>
              Downloaded {r.downloadCount}× · last {when(r.lastDownloadedAt)}
              {r.rowCountDelivered != null && ` · ${r.rowCountDelivered} rows delivered`}
            </div>
          )}
        </div>
      )}

      {isApprover && r.status === 'PENDING' && (
        <div className="mt-3 flex flex-col sm:flex-row gap-2 sm:items-center">
          <input
            value={note}
            onChange={(e) => onNote(e.target.value)}
            placeholder="Optional note (recorded either way)"
            className="flex-1 bg-lt-inner border border-lt-hairline rounded px-3 py-1.5 text-sm text-lt-fg"
          />
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => onDecide(r.id, 'APPROVE')}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg"
            >
              Approve
            </button>
            <button
              disabled={busy}
              onClick={() => onDecide(r.id, 'DENY')}
              className="px-3 py-1.5 bg-lt-inner hover:bg-lt-hairline disabled:opacity-40 text-lt-fg text-sm font-medium rounded-lg"
            >
              Deny
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
