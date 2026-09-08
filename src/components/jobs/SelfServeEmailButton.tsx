'use client'

/**
 * "Send next-steps email" — review, then send, for a job the client set
 * up themselves.
 *
 * Wes 2026-09-08: "show me the email before sending." Opening the modal
 * only COMPOSES (GET); nothing leaves until the Send button is pressed,
 * and the body is recomposed server-side at that moment so what goes out
 * reflects the paperwork state as of the send, not as of the preview.
 *
 * The CC line is shown, not editable — it is the admin-managed sales-desk
 * channel, changed once at /admin/notifications rather than per email.
 */

import { useCallback, useEffect, useState } from 'react'
import { Mail, X } from 'lucide-react'

interface Draft {
  orderNumber: string
  jobName: string
  to: string
  cc: string[]
  replyTo: string | null
  subject: string
  html: string
  alreadySentAt: string | null
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export function SelfServeEmailButton({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await fetch(`/api/jobs/${jobId}/self-serve-email`)
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not compose the email.')
      setDraft(j.draft)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not compose the email.')
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    if (open && !draft && !err) void load()
  }, [open, draft, err, load])

  async function send(confirmResend: boolean) {
    setSending(true)
    setErr(null)
    try {
      const r = await fetch(`/api/jobs/${jobId}/self-serve-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmResend }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Send failed.')
      setSentTo(j.to)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Send failed.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-lt-hairline px-3 py-1.5 text-xs font-semibold text-lt-fg2 hover:text-lt-fg hover:border-lt-fg3"
        title="Review the next-steps email, then send it"
      >
        <Mail className="w-3.5 h-3.5" /> Next-steps email
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-lt-card shadow-xl my-8">
            <div className="flex items-center justify-between gap-3 border-b border-lt-hairline px-5 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-lt-fg">Next-steps email</div>
                <div className="text-xs text-lt-fg3 truncate">
                  {draft ? `${draft.jobName} · ${draft.orderNumber}` : 'Composing…'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setOpen(false); setDraft(null); setErr(null); setSentTo(null) }}
                className="text-lt-fg3 hover:text-lt-fg"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              {loading && <p className="text-sm text-lt-fg2">Composing the email…</p>}
              {err && (
                <p className="rounded-lg bg-chip-bad-bg px-3 py-2 text-sm text-chip-bad-fg">{err}</p>
              )}

              {sentTo && (
                <p className="rounded-lg bg-chip-good-bg px-3 py-2 text-sm text-chip-good-fg">
                  Sent to {sentTo}.
                </p>
              )}

              {draft && !sentTo && (
                <>
                  {draft.alreadySentAt && (
                    <p className="rounded-lg bg-chip-warn-bg px-3 py-2 text-sm text-chip-warn-fg">
                      This already went out {fmtWhen(draft.alreadySentAt)}. Sending again is fine — it
                      will be recomposed from where the paperwork stands now.
                    </p>
                  )}
                  <dl className="space-y-1 text-sm">
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-lt-fg3">To</dt>
                      <dd className="text-lt-fg">{draft.to}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-lt-fg3">CC</dt>
                      <dd className="text-lt-fg">
                        {draft.cc.length ? draft.cc.join(', ') : <span className="text-lt-fg3">none configured</span>}
                        <span className="block text-xs text-lt-fg3">
                          The sales-desk copy list, changed at /admin/notifications.
                        </span>
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-lt-fg3">Reply-to</dt>
                      <dd className="text-lt-fg">
                        {draft.replyTo ?? <span className="text-lt-fg3">the desk (no rep established on this order)</span>}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-lt-fg3">Subject</dt>
                      <dd className="text-lt-fg font-medium">{draft.subject}</dd>
                    </div>
                  </dl>

                  <iframe
                    title="Email preview"
                    sandbox=""
                    srcDoc={draft.html}
                    className="h-[420px] w-full rounded-xl border border-lt-hairline bg-white"
                  />
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-lt-hairline px-5 py-3">
              <button
                type="button"
                onClick={() => { setOpen(false); setDraft(null); setErr(null); setSentTo(null) }}
                className="px-3 py-2 text-sm text-lt-fg2 hover:text-lt-fg"
              >
                {sentTo ? 'Close' : 'Cancel'}
              </button>
              {draft && !sentTo && (
                <button
                  type="button"
                  onClick={() => void send(!!draft.alreadySentAt)}
                  disabled={sending}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
                >
                  {sending ? 'Sending…' : draft.alreadySentAt ? 'Send again' : 'Send it'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
