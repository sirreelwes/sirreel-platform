'use client'

/**
 * "Send estimate to client" — review-then-send.
 *
 * The rep sees the rendered email before anyone else does, because this is
 * the one surface where a subcontracted vehicle's numbers leave the
 * building. What renders here is what the server composed; the send re-composes
 * server-side from the same function, so the preview cannot drift from the
 * message and the browser can't post markup of its own into a client's inbox.
 *
 * The estimate carries LIST rates only — our negotiated discount is never in
 * the payload. See src/lib/sub-rentals/estimateEmail.ts.
 */

import { useCallback, useEffect, useState } from 'react'

interface Composed {
  subject: string
  html: string
  defaultBody: string
  unitUrl: string | null
  replyTo: string | null
}

export default function SendEstimateModal({
  vehicleId,
  vehicleName,
  onClose,
}: {
  vehicleId: string
  vehicleName: string
  onClose: () => void
}) {
  const [to, setTo] = useState('')
  const [firstName, setFirstName] = useState('')
  const [message, setMessage] = useState('')
  const [composed, setComposed] = useState<Composed | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const compose = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (message.trim()) qs.set('message', message)
      if (firstName.trim()) qs.set('firstName', firstName)
      const r = await fetch(`/api/sub-rentals/vehicles/${vehicleId}/estimate?${qs}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) { setError(j.error ?? 'Could not build the estimate.'); setComposed(null); return }
      setError(null)
      setComposed(j)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed')
    } finally { setLoading(false) }
  }, [vehicleId, message, firstName])

  // Re-render the preview as the rep types, debounced so every keystroke
  // isn't a round trip.
  useEffect(() => {
    const t = setTimeout(compose, 350)
    return () => clearTimeout(t)
  }, [compose])

  async function send() {
    setSending(true); setError(null)
    try {
      const r = await fetch(`/api/sub-rentals/vehicles/${vehicleId}/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, firstName, message }),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error ?? 'Send failed.'); return }
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed')
    } finally { setSending(false) }
  }

  const canSend = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim()) && !!composed && !sending

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-xl w-full max-w-4xl my-8 shadow-xl">
        <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">
            Send estimate — {vehicleName}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        {sent ? (
          <div className="p-6">
            <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
              Estimate sent to {to}.
            </p>
            <button
              onClick={onClose}
              className="mt-4 px-3 py-1.5 text-sm rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-gray-200">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Client email
                </label>
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="producer@production.com"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  First name <span className="font-normal normal-case text-gray-400">(greeting)</span>
                </label>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="there"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Your message
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  placeholder={composed?.defaultBody ?? ''}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Leave blank to use the standard wording shown in the preview.
                </p>
              </div>
            </div>

            {error && (
              <div className="mx-5 mt-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
                {error}
              </div>
            )}

            <div className="p-5">
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Preview</div>
                {composed?.replyTo && (
                  <div className="text-xs text-gray-500">Replies go to {composed.replyTo}</div>
                )}
              </div>
              {composed && (
                <div className="text-sm text-gray-700 mb-2">
                  <span className="text-gray-500">Subject:</span> {composed.subject}
                </div>
              )}
              <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                {loading && !composed ? (
                  <div className="p-8 text-center text-sm text-gray-400">Building preview…</div>
                ) : composed ? (
                  <iframe
                    title="Estimate preview"
                    srcDoc={composed.html}
                    sandbox=""
                    className="w-full h-[520px] bg-white"
                  />
                ) : (
                  <div className="p-8 text-center text-sm text-gray-400">No preview.</div>
                )}
              </div>
              {composed && !composed.unitUrl && (
                <p className="mt-2 text-xs text-amber-700">
                  No client page has been created yet, so the estimate has no photos link.
                </p>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={send}
                disabled={!canSend}
                className="px-3 py-1.5 text-sm rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Send estimate'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
