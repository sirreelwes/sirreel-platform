'use client'

/**
 * "Sarah asked to move the pickup to the 17th" — the client's request,
 * on the order it is about.
 *
 * Wes 2026-09-18, on the L'anza job: "client said they wanted to change the
 * pickup date but couldn't figure out how to do that." Now they can ask
 * from the portal — and an ask that only reaches an inbox is an ask that
 * gets missed, so it is also here, on the screen the change is made from,
 * with the button that makes it.
 *
 * The button opens the ORDINARY "Change dates…" modal, seeded with what
 * they asked for. That is the whole point: a client's words never move a
 * booking by themselves (Wes 2026-09-11), and moving dates is the most
 * cascading edit in the system — the rep still reads the totals delta, the
 * unit conflicts and the custom-dated lines before anything is written.
 * Applying closes the request; so does "Close this".
 */

import { useState } from 'react'

export interface ClientDateChangeRequestData {
  id: string
  requestedByName: string | null
  requestedByEmail: string | null
  askedStart: string | null
  askedEnd: string | null
  requestedStart: string | null
  requestedEnd: string | null
  note: string | null
  createdAt: string
  currentStart: string | null
  currentEnd: string | null
  drifted: boolean
}

function pretty(day: string | null): string {
  if (!day) return '—'
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function ClientDateChangeRequest({
  orderId,
  request,
  onOpenChangeDates,
  onChanged,
}: {
  orderId: string
  request: ClientDateChangeRequestData
  /** Opens PushDatesModal seeded with the requested dates. */
  onOpenChangeDates: () => void
  onChanged: () => void
}) {
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState('')

  const who = request.requestedByName || request.requestedByEmail || 'The client'
  const named = !!(request.requestedStart || request.requestedEnd)

  const close = async () => {
    if (!confirm('Close this request? The client is not told — tell them on the job thread.')) return
    setClosing(true)
    setError('')
    try {
      const res = await fetch(`/api/orders/${orderId}/date-change-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: request.id, reason: 'HANDLED' }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error || 'Could not close that.')
        return
      }
      onChanged()
    } catch {
      setError('Could not close that.')
    } finally {
      setClosing(false)
    }
  }

  return (
    <div id="date-change-request" className="rounded-xl border border-chip-warn-fg/25 bg-chip-warn-bg p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest font-semibold text-chip-warn-fg">
            Client asked to change the dates
          </div>
          <p className="text-sm text-lt-fg mt-1">
            <strong>{who}</strong> {named ? 'asked to move this order' : 'asked about these dates'} ·{' '}
            {ago(request.createdAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          disabled={closing}
          className="text-xs text-lt-fg3 hover:text-lt-fg disabled:opacity-50 shrink-0"
          title="Stop asking — handled, or not happening"
        >
          {closing ? 'Closing…' : 'Close this'}
        </button>
      </div>

      {named && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-lt-fg3 font-semibold">Pickup</div>
            <div className="text-lt-fg mt-0.5">
              {request.requestedStart ? (
                <>
                  {pretty(request.currentStart)} → <strong>{pretty(request.requestedStart)}</strong>
                </>
              ) : (
                <span className="text-lt-fg3">{pretty(request.currentStart)} (unchanged)</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-lt-fg3 font-semibold">Return</div>
            <div className="text-lt-fg mt-0.5">
              {request.requestedEnd ? (
                <>
                  {pretty(request.currentEnd)} → <strong>{pretty(request.requestedEnd)}</strong>
                </>
              ) : (
                <span className="text-lt-fg3">{pretty(request.currentEnd)} (unchanged)</span>
              )}
            </div>
          </div>
        </div>
      )}

      {request.note && (
        <p className="mt-3 text-sm text-lt-fg2 italic border-l-2 border-chip-warn-fg/30 pl-3">
          &ldquo;{request.note}&rdquo;
        </p>
      )}

      {/* The order moved after they asked. Not a block — but applying
          "their" pickup now would silently undo whatever changed since,
          so the rep is told before they press the button. */}
      {request.drifted && (
        <p className="mt-3 text-xs text-chip-warn-fg">
          Heads up: this order&rsquo;s dates have changed since they asked. They were looking at{' '}
          {pretty(request.askedStart)} – {pretty(request.askedEnd)}; it now reads{' '}
          {pretty(request.currentStart)} – {pretty(request.currentEnd)}.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onOpenChangeDates}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg"
        >
          {named ? 'Review in Change dates…' : 'Open Change dates…'}
        </button>
        <span className="text-[11px] text-lt-fg3">
          Nothing has moved — applying it there closes this request.
        </span>
      </div>
    </div>
  )
}
