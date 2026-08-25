'use client'

/**
 * "The client answered" card — the staff half of the /details/<token> loop.
 *
 * Wes, 2026-08-25: a client's typed answer is a SUGGESTION, not a fact. The
 * person who replies to a quote email is often a coordinator, not the entity
 * that gets billed, and an unreviewed answer would otherwise become a real
 * Company row and the client identity on a booking. So the answer lands here
 * verbatim and an agent decides.
 *
 * "Use these" does NOT write the company or job. It hands the values to the
 * caller, which seeds the flows that already exist — CompanyPicker (near-match
 * discipline) and JobResolverModal (find-or-create with overlap ranking) — so
 * there stays exactly one code path that can create those rows.
 */

import { useState } from 'react'

export interface ClientDetailReply {
  id: string
  inquiryId: string | null
  bookingId: string | null
  companyName: string | null
  projectName: string | null
  sentToEmail: string | null
  createdAt: string
}

interface Props {
  reply: ClientDetailReply
  /** Seeds the caller's own accept flow with the client's words. Omit to
   *  render an informational card with Dismiss only. */
  onUse?: (values: { companyName: string | null; projectName: string | null }) => void
  /** Fired after the reply is resolved, so the caller can refresh. */
  onResolved?: () => void
  compact?: boolean
}

export function ClientDetailSuggestion({ reply, onUse, onResolved, compact }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gone, setGone] = useState(false)

  if (gone) return null

  async function resolve(action: 'applied' | 'dismissed') {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/client-details/${reply.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setError(json?.error || 'Could not save that.')
        return
      }
      setGone(true)
      onResolved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  const values = [reply.companyName, reply.projectName].filter(Boolean).join(' · ')

  return (
    <div className={`rounded-lg border border-sky-300 bg-sky-50 ${compact ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}>
      <div className="flex items-center gap-1.5">
        <span aria-hidden className="text-sky-600 text-[13px] leading-none">✉</span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-sky-900">
          The client answered
        </span>
      </div>

      <div className={`mt-1 ${compact ? 'text-[12px]' : 'text-[13px]'} text-sky-950`}>
        {reply.companyName && (
          <div>
            <span className="text-sky-700">Company:</span>{' '}
            <span className="font-semibold">{reply.companyName}</span>
          </div>
        )}
        {reply.projectName && (
          <div>
            <span className="text-sky-700">Project:</span>{' '}
            <span className="font-semibold">{reply.projectName}</span>
          </div>
        )}
        {!values && <div className="italic text-sky-700">No values submitted.</div>}
      </div>

      <div className="mt-2 flex items-center gap-2">
        {onUse && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onUse({ companyName: reply.companyName, projectName: reply.projectName })
              void resolve('applied')
            }}
            className="rounded bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
          >
            Use these
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void resolve('dismissed')}
          className="text-[11px] font-medium text-sky-800 underline underline-offset-2 hover:text-sky-950 disabled:opacity-50"
        >
          Dismiss
        </button>
        {reply.sentToEmail && (
          <span className="ml-auto truncate text-[10px] text-sky-700" title={`We emailed ${reply.sentToEmail}`}>
            from {reply.sentToEmail}
          </span>
        )}
      </div>

      {error && <div className="mt-1 text-[11px] font-medium text-rose-700">{error}</div>}
    </div>
  )
}
