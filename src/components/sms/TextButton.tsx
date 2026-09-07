'use client'
/**
 * "Text" — the staff send-a-text button beside a phone number on the job page.
 *
 * Wes 2026-09-07: texting is for "non-normal situations — last-minute
 * changes". So this is a plain composer, not a template engine: a short
 * message, the recipient's consent state shown before you type, and the
 * STOP line appended by the server. Sends as the signed-in agent, logged on
 * the job (SmsMessage.jobId) with the Twilio id for delivery status.
 *
 * Consent states, from /api/jobs/[id]/sms?phone=:
 *   opted-in   — they agreed (portal, partner page, form, START).
 *   none       — a number on file with no answer either way. Sending is
 *                allowed for a booking they have with us, and the message
 *                carries the opt-out line; the state is shown so the agent
 *                knows.
 *   opted-out  — STOP on record. The button is disabled; call them.
 */
import { useEffect, useState } from 'react'
import { MessageSquare } from 'lucide-react'

type Consent = { state: 'opted-in' | 'opted-out' | 'none' | 'bad-number'; via: string | null; at: string | null }

export function TextButton({
  jobId, phone, name, subRentalId, size = 'sm',
}: { jobId: string; phone: string; name?: string | null; subRentalId?: string | null; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false)
  const [consent, setConsent] = useState<Consent | null>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    if (!open || consent) return
    fetch(`/api/jobs/${jobId}/sms?phone=${encodeURIComponent(phone)}`)
      .then((r) => r.json())
      .then((j) => setConsent(j.consent ?? { state: 'none', via: null, at: null }))
      .catch(() => setConsent({ state: 'none', via: null, at: null }))
  }, [open, consent, jobId, phone])

  async function send() {
    if (!body.trim()) return
    setBusy(true); setNote(null)
    try {
      const r = await fetch(`/api/jobs/${jobId}/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, body: body.trim(), subRentalId: subRentalId ?? null }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error ?? `Not sent (${j.status ?? r.status})`)
      setNote({ kind: 'ok', text: `Sent to ${name || phone}.` })
      setBody('')
    } catch (e) {
      setNote({ kind: 'err', text: e instanceof Error ? e.message : 'Not sent' })
    } finally {
      setBusy(false)
    }
  }

  const btn = size === 'md'
    ? 'inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-zinc-700 hover:border-amber-500 hover:text-amber-700'
    : 'inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-600 hover:text-amber-700'

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={btn} title={`Text ${name || phone}`}>
        <MessageSquare size={size === 'md' ? 14 : 12} aria-hidden /> Text
      </button>
    )
  }

  const optedOut = consent?.state === 'opted-out'
  const stateLine = !consent
    ? 'Checking consent…'
    : consent.state === 'opted-in'
      ? `Opted in${consent.via ? ` via ${consent.via.replace('-', ' ')}` : ''}.`
      : consent.state === 'opted-out'
        ? 'This number replied STOP. Texting is off — call them instead.'
        : consent.state === 'bad-number'
          ? 'That number can’t receive texts.'
          : 'No text consent on file yet. Fine for a booking they have with us; the message carries the opt-out line.'

  return (
    <div className="mt-2 w-full max-w-[520px] rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-[12px]">
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold text-zinc-800">Text {name || phone} <span className="font-mono font-normal text-zinc-500">{phone}</span></div>
        <button type="button" onClick={() => { setOpen(false); setNote(null) }} className="text-zinc-500 hover:text-zinc-800">Close</button>
      </div>
      <div className={`mt-1 ${optedOut ? 'text-rose-700' : consent?.state === 'opted-in' ? 'text-emerald-700' : 'text-zinc-600'}`}>{stateLine}</div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 480))}
        disabled={optedOut || consent?.state === 'bad-number'}
        placeholder="Short and specific — what changed, and where they can see the details."
        rows={3}
        className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-[13px] text-zinc-900 focus:outline-none focus:border-amber-500 disabled:bg-zinc-100"
      />
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span className="text-zinc-500">{body.length}/480 · “Reply STOP to opt out.” is added automatically</span>
        <button
          type="button"
          onClick={send}
          disabled={busy || optedOut || !body.trim() || !consent || consent.state === 'bad-number'}
          className="rounded-md bg-amber-600 hover:bg-amber-500 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send text'}
        </button>
      </div>
      {note && <div className={`mt-2 ${note.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{note.text}</div>}
    </div>
  )
}
