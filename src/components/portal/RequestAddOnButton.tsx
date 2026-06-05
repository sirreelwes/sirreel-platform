'use client'

import { useState } from 'react'

/**
 * Per-job "Request add-on" button + dialog for the /portal/account
 * page. POSTs to /api/portal/add-on-request which creates an
 * Inquiry the rep finalizes via the phase-1b add-on flow. We don't
 * create the Order directly — the human-in-the-loop is the safety
 * net for "did you really mean to add $5k of grip to your job?".
 *
 * Mounted under each active-job card with the job's id + name.
 * Notes are optional but encouraged (the client describes what
 * they need; the rep sees this in the inquiry description).
 */
export function RequestAddOnButton({
  jobId,
  jobName,
}: {
  jobId: string
  jobName: string
}) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/portal/add-on-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, notes: notes.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setError(data?.error || `Submit failed (HTTP ${res.status})`)
        return
      }
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSending(false)
    }
  }

  const close = () => {
    setOpen(false)
    // Reset state on close so a re-open is fresh.
    setNotes('')
    setError(null)
    setDone(false)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 text-xs font-semibold border border-zinc-300 text-zinc-700 hover:border-zinc-500 hover:text-zinc-900 px-3 py-1.5 rounded-lg"
      >
        + Request add-on
      </button>
    )
  }

  return (
    <div className="mt-3 rounded-lg border border-zinc-300 bg-white p-3">
      {done ? (
        <div className="text-sm">
          <div className="font-semibold text-emerald-700">Request sent.</div>
          <p className="mt-1 text-xs text-zinc-600">
            Your SirReel rep will follow up shortly about adding to{' '}
            <span className="font-semibold text-zinc-900">{jobName}</span>.
          </p>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={close}
              className="text-xs font-semibold text-zinc-600 hover:text-zinc-900"
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">
            Add-on to {jobName}
          </div>
          <p className="text-xs text-zinc-600 mb-2">
            Describe what you need and your rep will follow up with a quote. We don&apos;t
            charge anything until you approve.
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="e.g. Need an extra cargo van for Friday only, and 4 more chairs."
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-zinc-900"
          />
          {error && (
            <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {error}
            </div>
          )}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={close}
              disabled={sending}
              className="text-xs font-semibold text-zinc-600 hover:text-zinc-900 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={sending}
              className="text-xs font-semibold bg-zinc-900 hover:bg-black disabled:bg-zinc-400 text-white px-3 py-1.5 rounded-lg"
            >
              {sending ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
