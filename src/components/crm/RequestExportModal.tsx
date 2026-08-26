'use client'

/**
 * RequestExportModal — "Export CSV" on /crm.
 *
 * Deliberately NOT a download button. Wes's rule (2026-08-26): exporting the
 * client book requires his approval, so this submits a REQUEST and says so
 * plainly. The one case that downloads immediately is Wes himself, and the
 * copy changes to match rather than pretending a review happened.
 *
 * The current list filters ride along so Wes approves the same scope the
 * requester was looking at, and the row count is shown up front — "export
 * 480 clients" should feel like what it is.
 */

import { useEffect, useState } from 'react'

export interface ExportFilters {
  search?: string | null
  tier?: string | null
  segment?: string | null
}

interface Props {
  filters: ExportFilters
  onClose: () => void
}

export function RequestExportModal({ filters, onClose }: Props) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ id: string; autoApproved: boolean } | null>(null)
  // Approver status comes from the server, not from a client-side email
  // comparison — the allowlist has an env override the browser can't see.
  // Defaults to false, so the cautious "this goes to Wes" copy is what
  // renders if the probe fails.
  const [isApprover, setIsApprover] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/exports/requests')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setIsApprover(!!d.isApprover) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/exports/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), filters }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || 'Could not submit the request.')
        return
      }
      setDone({ id: data.request.id, autoApproved: !!data.autoApproved })
    } catch {
      setError('Could not submit the request.')
    } finally {
      setSaving(false)
    }
  }

  const scopeBits = [
    filters.search ? `matching "${filters.search}"` : null,
    filters.tier ? `tier ${filters.tier}` : null,
    filters.segment ? `segment: ${filters.segment}` : null,
  ].filter(Boolean)

  return (
    <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center bg-black/70 md:px-4 md:py-8">
      <div className="bg-lt-card w-full h-full md:h-auto md:max-h-[90vh] md:max-w-lg md:rounded-xl md:border md:border-lt-hairline flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-lt-hairline">
          <h2 className="text-base font-semibold text-lt-fg">
            {isApprover ? 'Export client list' : 'Request client-list export'}
          </h2>
          <button onClick={onClose} className="text-lt-muted hover:text-lt-fg text-sm px-2 py-1">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {done ? (
            <div className="space-y-3">
              {done.autoApproved ? (
                <>
                  <p className="text-sm text-lt-fg">
                    Approved — you&apos;re the approver, so this was released immediately
                    and logged as such.
                  </p>
                  <a
                    href={`/api/exports/requests/${done.id}/download`}
                    className="inline-block px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg"
                  >
                    Download CSV
                  </a>
                </>
              ) : (
                <p className="text-sm text-lt-fg">
                  Sent to Wes for approval. Nothing downloads until he approves it —
                  you&apos;ll find it under Clients → your requests once decided.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="text-sm bg-lt-inner border border-lt-hairline rounded px-3 py-2 text-lt-fg">
                <div className="font-medium mb-1">What gets exported</div>
                <div className="text-lt-muted">
                  {scopeBits.length ? scopeBits.join(', ') : 'All clients'} — company,
                  tier, spend, billing email/address, agent, COI status, discount
                  profile and current contacts.
                </div>
              </div>

              {!isApprover && (
                <div className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded px-3 py-2">
                  This is client-confidential data. Your request goes to Wes for
                  approval — it does not download now.
                </div>
              )}

              <div>
                <label className="block text-sm text-lt-muted mb-1">
                  {isApprover ? 'Note for the record' : 'Why do you need this?'}
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={4}
                  autoFocus
                  placeholder="e.g. Building the Q4 outreach list for the studio accounts."
                  className="w-full bg-lt-inner border border-lt-hairline rounded px-3 py-2 text-sm text-lt-fg resize-none"
                />
                <div className="mt-1 text-xs text-lt-muted">
                  {reason.trim().length < 10
                    ? `${10 - reason.trim().length} more characters needed`
                    : 'Recorded with the request.'}
                </div>
              </div>

              {error && <div className="text-sm text-red-600">{error}</div>}
            </>
          )}
        </div>

        {!done && (
          <div className="px-4 py-3 border-t border-lt-hairline flex gap-2 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-lt-inner hover:bg-lt-hairline text-lt-fg text-sm font-medium rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving || reason.trim().length < 10}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg"
            >
              {saving ? 'Submitting…' : isApprover ? 'Export now' : 'Send request to Wes'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
