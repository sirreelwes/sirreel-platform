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
 *
 * Job + dates drive the PARTNER side. With both set, sending also creates a
 * "potential" sub-rental on that job and tells the unit's owner we've quoted
 * their dates (see lib/sub-rentals/potentialSubRental.ts). They're optional —
 * a rep pricing something up for a client who hasn't named a show yet can
 * still send — but the vendor only finds out when they're filled in, so the
 * form says as much rather than failing quietly.
 */

import { useCallback, useEffect, useState } from 'react'
import { JobResolverModal, type ResolvedJob } from '@/components/shared/JobResolverModal'

interface Composed {
  subject: string
  html: string
  defaultBody: string
  unitUrl: string | null
  replyTo: string | null
  /** Shared sales group CC'd on every estimate; null when disabled. */
  teamCc: string | null
}

interface SendResult {
  created: boolean
  notified: boolean
  warning?: string
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
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [job, setJob] = useState<ResolvedJob | null>(null)
  const [resolverOpen, setResolverOpen] = useState(false)
  const [composed, setComposed] = useState<Composed | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<SendResult | null>(null)
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
        body: JSON.stringify({
          to, firstName, message,
          jobId: job?.id ?? null,
          startDate: startDate || null,
          endDate: endDate || null,
        }),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error ?? 'Send failed.'); return }
      setSent({ created: !!j.created, notified: !!j.notified, warning: j.warning })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed')
    } finally { setSending(false) }
  }

  const datesOk = !!startDate && !!endDate && endDate >= startDate
  const willNotifyVendor = !!job && datesOk
  const canSend = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim()) && !!composed && !sending
    && (!startDate || !endDate || datesOk)

  const field = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm'
  const label = 'block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1'

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-xl w-full max-w-4xl my-8 shadow-xl">
        <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">Send estimate — {vehicleName}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        {sent ? (
          <div className="p-6 space-y-3">
            <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
              Estimate sent to {to}.
              {sent.created && ' Potential sub-rental created on the job.'}
              {sent.notified && ' The unit’s owner has been notified of the dates.'}
            </p>
            {sent.warning && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                {sent.warning}
              </p>
            )}
            {!sent.created && (
              <p className="text-xs text-gray-500">
                No job or dates were set, so no sub-rental was created and the owner was not notified.
              </p>
            )}
            <button
              onClick={onClose}
              className="mt-1 px-3 py-1.5 text-sm rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-gray-200">
              <div>
                <label className={label}>Client email</label>
                <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="producer@production.com" className={field} />
              </div>
              <div>
                <label className={label}>
                  First name <span className="font-normal normal-case text-gray-400">(greeting)</span>
                </label>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="there" className={field} />
              </div>

              {/* Job + dates: the partner side of the send. */}
              <div className="md:col-span-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className={label + ' mb-0'}>Job</div>
                  <button
                    onClick={() => setResolverOpen(true)}
                    className="text-xs font-semibold text-amber-700 hover:text-amber-600"
                  >
                    {job ? 'Change' : 'Add to a job'}
                  </button>
                </div>
                {job ? (
                  <div className="text-sm text-gray-800">
                    <span className="font-mono text-xs text-gray-500 mr-1.5">{job.jobCode}</span>
                    {job.name}
                    {job.created && (
                      <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">new</span>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">No job yet — pick an existing one or start a new one.</div>
                )}

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className={label}>Start</label>
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={field} />
                  </div>
                  <div>
                    <label className={label}>End</label>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={field} />
                  </div>
                </div>
                {startDate && endDate && !datesOk && (
                  <p className="mt-2 text-xs text-rose-700">End date cannot be before the start date.</p>
                )}
                <p className="mt-2 text-xs text-gray-500">
                  {willNotifyVendor
                    ? 'On send: a potential sub-rental is created on this job, and the unit’s owner is told we quoted these dates. It holds nothing.'
                    : 'Set a job and both dates to create a potential sub-rental and notify the unit’s owner. Without them the estimate still sends.'}
                </p>
              </div>

              <div className="md:col-span-2">
                <label className={label}>Your message</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  placeholder={composed?.defaultBody ?? ''}
                  className={field}
                />
                <p className="mt-1 text-xs text-gray-500">Leave blank to use the standard wording shown in the preview.</p>
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
                <div className="text-xs text-gray-500 flex gap-3">
                  {composed?.teamCc && <span>CC {composed.teamCc}</span>}
                  {composed?.replyTo && <span>Replies go to {composed.replyTo}</span>}
                </div>
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
                  <iframe title="Estimate preview" srcDoc={composed.html} sandbox="" className="w-full h-[520px] bg-white" />
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
              <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">
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

      {resolverOpen && (
        <JobResolverModal
          context={{
            contactEmail: to.trim() || null,
            contactName: firstName.trim() || null,
            jobNameHint: null,
            dates: startDate && endDate ? { start: startDate, end: endDate } : null,
            sourceRef: `sub-rental:${vehicleId}`,
          }}
          onResolved={(j: ResolvedJob) => { setJob(j); setResolverOpen(false) }}
          onClose={() => setResolverOpen(false)}
        />
      )}
    </div>
  )
}
