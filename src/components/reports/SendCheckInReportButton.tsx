'use client'

/**
 * "Send check-in report" — the button Wes asked for on 2026-09-18:
 * *"We need to then send a report, or actually, Albert sends a report, on
 * missing items or 100% returned. We need to add that button."*
 *
 * One tap on the first send. It is internal mail to the desk that is
 * waiting for it (billing, the hq feed, the order's own agent), it is the
 * whole point of the screen, and a confirm step in front of it would be a
 * second thing to teach the floor.
 *
 * A RE-send is the one that asks, because a second copy of the same
 * report is the mistake available here: the screen already says when the
 * last one went and to whom, so the question is answerable without
 * leaving it.
 *
 * What it never does is send by itself. A check-in is counted in passes,
 * and the report says the count is finished — only a person knows that.
 */

import { useState } from 'react'
import { Send, Check, AlertTriangle } from 'lucide-react'

const fmtWhen = (iso: string) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  }).format(new Date(iso))

export function SendCheckInReportButton({
  orderId,
  sentAt = null,
  sentTo = [],
  tone = 'primary',
  /** Why it cannot be sent yet — an unfinished count, mostly. */
  blockedReason = null,
}: {
  orderId: string
  sentAt?: string | null
  sentTo?: string[]
  tone?: 'primary' | 'secondary'
  blockedReason?: string | null
}) {
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; to: string[]; at: string | null; reason?: string } | null>(null)
  const [confirming, setConfirming] = useState(false)

  const lastSentAt = result?.ok ? result.at : sentAt
  const lastSentTo = result?.ok ? result.to : sentTo

  async function send() {
    setSending(true)
    setConfirming(false)
    try {
      const res = await fetch(`/api/orders/${orderId}/check-report/send`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      setResult(
        res.ok && data.sent
          ? { ok: true, to: data.to ?? [], at: data.sentAt ?? new Date().toISOString() }
          : { ok: false, to: [], at: null, reason: data.reason || `The report could not be sent (${res.status}).` },
      )
    } catch (e) {
      setResult({ ok: false, to: [], at: null, reason: e instanceof Error ? e.message : 'The report could not be sent.' })
    } finally {
      setSending(false)
    }
  }

  if (blockedReason) {
    return <p className="text-[13px] text-lt-fg3 max-w-[52ch]">{blockedReason}</p>
  }

  const label = lastSentAt ? 'Send it again' : 'Send check-in report'
  const cls =
    tone === 'primary'
      ? 'bg-amber-600 hover:bg-amber-500 text-white'
      : 'border border-lt-hairline text-lt-fg2 hover:text-lt-fg hover:bg-lt-inner'

  return (
    <div>
      {confirming ? (
        <div className="border border-lt-hairline bg-lt-inner rounded-xl px-3 py-3 text-left">
          <p className="text-[14px] text-lt-fg2">
            This report already went out{lastSentAt ? ` ${fmtWhen(lastSentAt)}` : ''}
            {lastSentTo.length ? ` to ${lastSentTo.join(', ')}` : ''}. Send another copy?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={send}
              disabled={sending}
              className="min-h-[44px] px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[15px] font-bold disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send it again'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="min-h-[44px] px-4 rounded-lg border border-lt-hairline text-lt-fg2 text-[15px] font-semibold"
            >
              Not now
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => (lastSentAt ? setConfirming(true) : send())}
          disabled={sending}
          className={`min-h-[52px] px-6 rounded-xl text-[16px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50 ${cls}`}
        >
          <Send size={17} aria-hidden />
          {sending ? 'Sending…' : label}
        </button>
      )}

      {/* Say who it reached. A report the sender cannot see the audience
          of is one they will send again from their own mailbox. */}
      {result?.ok && (
        <p className="mt-2 text-[14px] text-chip-good-fg inline-flex items-start gap-1.5">
          <Check size={15} aria-hidden className="flex-none mt-0.5" />
          <span>Sent to {result.to.join(', ')}.</span>
        </p>
      )}
      {result && !result.ok && (
        <p className="mt-2 text-[14px] text-chip-bad-fg inline-flex items-start gap-1.5">
          <AlertTriangle size={15} aria-hidden className="flex-none mt-0.5" />
          <span>{result.reason}</span>
        </p>
      )}
      {!result && lastSentAt && (
        <p className="mt-2 text-[13px] text-lt-fg3">
          Last sent {fmtWhen(lastSentAt)}
          {lastSentTo.length ? ` to ${lastSentTo.join(', ')}` : ''}.
        </p>
      )}
    </div>
  )
}
