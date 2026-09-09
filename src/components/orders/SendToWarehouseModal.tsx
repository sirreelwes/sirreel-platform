'use client'

/**
 * "Send pull order to warehouse" — the confirm dialog.
 *
 * Wes, 2026-09-09. Preview-first for the same reason PushDatesModal is:
 * the button fires an email to the floor, and the rep should see what
 * the floor is about to be told before it goes. The dialog shows the
 * pickup window, the line count, the readiness blockers that will ride
 * along NAMED (they do not block the send — see
 * lib/warehouse/sendPullOrder.ts), who receives it, and — on a re-send
 * — when it last went and who sent it.
 *
 * The sheet is ATTACHED to that email as a PDF (Wes, 2026-09-09), so
 * the floor can print and pull without an HQ login.
 *
 * The note field is the whole point of a dialog rather than a bare
 * button: "front half only, the LED package is still a maybe" is the
 * sentence that keeps the floor from pulling the wrong half of a quote
 * the client hasn't finished deciding on.
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Send } from 'lucide-react'

interface Preview {
  orderNumber: string
  companyName: string
  jobId: string | null
  jobCode: string | null
  jobName: string | null
  startDate: string | null
  endDate: string | null
  deliveryRequested: boolean
  pickableCount: number
  warehouseLineCount: number
  blockers: string[]
  ready: boolean
  recipientCount: number
  lastSentAt: string | null
  lastSentBy: string | null
  pullSheetHref: string
}

export interface SendToWarehouseResult {
  orderNumber: string
  resent: boolean
  recipients: number
  emailSent: boolean
  emailReason?: string
  sheetAttached: boolean
  blockers: string[]
}

/** Calendar dates are stored at UTC midnight — render them in UTC or
 *  every pickup reads as the day before. */
function fmt(d: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Sent-at is a real instant, so it renders in local time. */
function fmtSent(d: string): string {
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return ''
  return dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function SendToWarehouseModal({
  orderId,
  onClose,
  onSent,
}: {
  orderId: string
  onClose: () => void
  onSent: (result: SendToWarehouseResult) => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/orders/${orderId}/send-to-warehouse`, { cache: 'no-store' })
      .then(async (r) => {
        const json = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) setLoadError(json?.error || `HTTP ${r.status}`)
        else setPreview(json.preview)
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load the order.')
      })
    return () => { cancelled = true }
  }, [orderId])

  const send = useCallback(async () => {
    if (sending) return
    setSending(true)
    setSendError(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/send-to-warehouse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() || null }),
      })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) {
        setSendError(json?.error || `HTTP ${r.status}`)
        return
      }
      onSent(json as SendToWarehouseResult)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Send failed.')
    } finally {
      setSending(false)
    }
  }, [orderId, note, sending, onSent])

  const nothingToPull = preview != null && preview.pickableCount === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8">
      <div className="bg-lt-card border border-lt-hairline rounded-xl w-full max-w-lg max-h-full overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-lt-hairline flex items-center justify-between">
          <h3 className="text-lg font-semibold text-lt-fg">Send pull order to warehouse</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="text-sm text-lt-fg2 hover:text-lt-fg disabled:opacity-50"
          >
            Close
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto space-y-4">
          {loadError && (
            <div className="text-sm text-chip-bad-fg bg-chip-bad-bg border border-chip-bad-fg/30 rounded-lg px-3 py-2">
              {loadError}
            </div>
          )}
          {!preview && !loadError && <div className="text-sm text-lt-fg3">Loading…</div>}

          {preview && (
            <>
              <p className="text-[13px] leading-relaxed text-lt-fg2">
                The warehouse gets the pull sheet as a{' '}
                <span className="font-semibold text-lt-fg">PDF attachment</span> — printable without an HQ
                login — and this order appears on the picking floor even if it isn&apos;t booked yet, because
                you said so.
              </p>

              <dl className="rounded-lg border border-lt-hairline bg-lt-inner divide-y divide-lt-hairline text-[13px]">
                {[
                  ['Order', preview.orderNumber],
                  ['Client', preview.companyName],
                  ['Job', preview.jobName ? `${preview.jobName}${preview.jobCode ? ` (${preview.jobCode})` : ''}` : '—'],
                  [
                    'Pick up',
                    preview.startDate && preview.endDate && preview.startDate !== preview.endDate
                      ? `${fmt(preview.startDate)} → ${fmt(preview.endDate)}`
                      : fmt(preview.startDate),
                  ],
                  ['Out', preview.deliveryRequested ? 'Delivery' : 'Will call'],
                  ['Lines to pull', String(preview.pickableCount)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-4 px-3 py-2">
                    <dt className="text-lt-fg3 uppercase tracking-wider text-[10px] font-semibold">{label}</dt>
                    <dd className="text-lt-fg text-right">{value}</dd>
                  </div>
                ))}
              </dl>

              {nothingToPull && (
                <div className="text-sm text-chip-bad-fg bg-chip-bad-bg border border-chip-bad-fg/30 rounded-lg px-3 py-2">
                  Nothing to pull — every line on this order is a fee, discount or labor.
                </div>
              )}

              {/* Named, not blocking. The rep decides; the floor is told. */}
              {preview.blockers.length > 0 && (
                <div className="flex gap-2.5 rounded-lg border border-chip-warn-fg/40 bg-chip-warn-bg px-3 py-2.5 text-[13px] text-chip-warn-fg">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
                  <div>
                    <span className="font-semibold">Still outstanding: {preview.blockers.join(', ')}.</span>{' '}
                    The email says so too — the floor can pull it, but it doesn&apos;t leave the yard until
                    these clear.
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="pull-note" className="block text-[13px] font-medium text-lt-fg mb-1">
                  Note for the floor <span className="text-lt-fg3 font-normal">(optional)</span>
                </label>
                <textarea
                  id="pull-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="Front half only — the LED package is still a maybe. Client picks up at 7am."
                  className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg placeholder:text-lt-fg3 focus:outline-none focus:border-lt-fg2 resize-y"
                />
              </div>

              <div className="text-[12px] text-lt-fg3 space-y-1">
                <div>
                  Goes to {preview.recipientCount}{' '}
                  {preview.recipientCount === 1 ? 'recipient' : 'recipients'} on the Warehouse pull orders
                  channel (warehouse@sirreel.com by default).
                  {preview.recipientCount === 0 && (
                    <span className="text-chip-warn-fg">
                      {' '}
                      Nobody is on it — set recipients in Admin → Notifications. The list still reaches the
                      picking floor.
                    </span>
                  )}
                </div>
                {preview.lastSentAt && (
                  <div>
                    Last sent {fmtSent(preview.lastSentAt)}
                    {preview.lastSentBy ? ` by ${preview.lastSentBy}` : ''} — this will replace it.
                  </div>
                )}
              </div>

              {sendError && (
                <div className="text-sm text-chip-bad-fg bg-chip-bad-bg border border-chip-bad-fg/30 rounded-lg px-3 py-2">
                  {sendError}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-lt-hairline flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="text-[13px] font-semibold px-3 py-1.5 rounded-lg border border-lt-hairline text-lt-fg hover:bg-lt-inner disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending || !preview || nothingToPull}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
          >
            <Send size={14} aria-hidden />
            {sending ? 'Sending…' : preview?.lastSentAt ? 'Send updated pull order' : 'Send to warehouse'}
          </button>
        </div>
      </div>
    </div>
  )
}
