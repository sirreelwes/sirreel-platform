'use client'

/**
 * Order-detail "Quote follow-up" panel (Mode A).
 *
 * Reads cadence state from GET /api/orders/[id]/follow-ups and renders:
 *   - Sent date / days elapsed / valid-until strip
 *   - Live status line (Check-in #N due | next in Xd | client replied — paused)
 *   - "Resend quote email"  → POST /api/orders/[id]/send-quote
 *   - "Send follow-up"      → modal preview → POST /api/orders/[id]/follow-ups/send
 *
 * The Send-follow-up button highlights amber when a stage is due. It's
 * disabled when the cadence is paused (client replied, status advanced,
 * or no quoteSentAt) — the strip explains why.
 */

import { useCallback, useEffect, useState } from 'react'

type CadenceStage = 'STAGE_1' | 'STAGE_2' | 'STAGE_3'

type PauseReason = 'never_sent' | 'status_advanced' | 'client_replied' | 'all_stages_sent'

interface CadenceStateApi {
  currentDueStage: CadenceStage | null
  stagesSent: CadenceStage[]
  dueDates: Record<CadenceStage, string>
  nextStage: CadenceStage | null
  nextStageAt: string | null
  paused: boolean
  pauseReason: PauseReason | null
  effectiveExpiresAt: string | null
}

interface FollowUpsApiResponse {
  orderId: string
  quoteSentAt: string | null
  effectiveExpiresAt: string | null
  threadLastInboundAt: string | null
  state: CadenceStateApi
  history: { stage: string; status: string; sentAt: string | null }[]
}

const STAGE_LABEL: Record<CadenceStage, string> = {
  STAGE_1: 'Check-in #1',
  STAGE_2: 'Check-in #2',
  STAGE_3: 'Check-in #3',
}

const STAGE_BLURB: Record<CadenceStage, string> = {
  STAGE_1: '~2 days after sent — did the quote land?',
  STAGE_2: '~halfway to expiry — still planning these dates?',
  STAGE_3: '~1–2 days before expiry — want to lock it in?',
}

function fmtRelative(d: Date, now: Date): string {
  const diffMs = d.getTime() - now.getTime()
  const absHr = Math.abs(diffMs) / 3_600_000
  if (absHr < 24) {
    const hr = Math.round(absHr)
    return diffMs >= 0 ? `in ${hr}h` : `${hr}h ago`
  }
  const days = Math.round(absHr / 24)
  return diffMs >= 0 ? `in ${days}d` : `${days}d ago`
}

function fmtDays(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86_400_000))
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface Props {
  orderId: string
  /** When true (status === DRAFT etc.), the whole panel is hidden — no quote
   *  has been sent yet so the cadence has nothing to track. */
  isQuoteSent: boolean
}

export function QuoteFollowUpPanel({ orderId, isQuoteSent }: Props) {
  const [data, setData] = useState<FollowUpsApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<null | 'resend' | CadenceStage>(null)
  const [modalStage, setModalStage] = useState<CadenceStage | null>(null)
  const [modalMessage, setModalMessage] = useState('')
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/follow-ups`, { cache: 'no-store' })
      if (!res.ok) {
        setData(null)
        return
      }
      const json = (await res.json()) as FollowUpsApiResponse
      setData(json)
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    if (isQuoteSent) void load()
  }, [load, isQuoteSent])

  if (!isQuoteSent) return null
  if (loading || !data) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
        <div className="text-sm text-zinc-500">Loading quote follow-up…</div>
      </div>
    )
  }

  const now = new Date()
  const sentAt = data.quoteSentAt ? new Date(data.quoteSentAt) : null
  const expiresAt = data.effectiveExpiresAt ? new Date(data.effectiveExpiresAt) : null
  const state = data.state
  const dueStage = state.currentDueStage
  const paused = state.paused

  const statusLine = (() => {
    if (paused && state.pauseReason === 'client_replied') return 'Client replied — paused'
    if (paused && state.pauseReason === 'status_advanced') return 'Order advanced past QUOTE_SENT — paused'
    if (paused && state.pauseReason === 'all_stages_sent') return 'All 3 check-ins sent'
    if (paused && state.pauseReason === 'never_sent') return 'Quote not sent yet'
    if (dueStage) return `${STAGE_LABEL[dueStage]} due now`
    if (state.nextStage && state.nextStageAt) {
      return `Next: ${STAGE_LABEL[state.nextStage]} ${fmtRelative(new Date(state.nextStageAt), now)}`
    }
    return 'Cadence idle'
  })()

  const statusTone = (() => {
    if (paused && state.pauseReason === 'client_replied') return 'text-emerald-400'
    if (paused) return 'text-zinc-400'
    if (dueStage) return 'text-amber-400'
    return 'text-zinc-300'
  })()

  const handleResend = async () => {
    setBusy('resend')
    setFeedback(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/send-quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.ok === false) {
        setFeedback({ kind: 'err', text: json?.error || 'Resend failed' })
      } else {
        setFeedback({ kind: 'ok', text: `Quote resent to ${json?.recipient?.email ?? 'client'}` })
        void load()
      }
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : 'Resend failed' })
    } finally {
      setBusy(null)
    }
  }

  const openSendModal = (stage: CadenceStage) => {
    setModalStage(stage)
    setModalMessage('')
    setFeedback(null)
  }

  const handleSendFollowUp = async () => {
    if (!modalStage) return
    setBusy(modalStage)
    setFeedback(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/follow-ups/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: modalStage,
          message: modalMessage.trim().length > 0 ? modalMessage.trim() : undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.ok === false) {
        setFeedback({ kind: 'err', text: json?.error || 'Send failed' })
      } else {
        setFeedback({ kind: 'ok', text: `${STAGE_LABEL[modalStage]} sent to ${json?.recipient?.email ?? 'client'}` })
        setModalStage(null)
        void load()
      }
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : 'Send failed' })
    } finally {
      setBusy(null)
    }
  }

  // Stage button — highlighted amber when this is the currently-due stage.
  const StageButton = ({ stage }: { stage: CadenceStage }) => {
    const isSent = state.stagesSent.includes(stage)
    const isDue = dueStage === stage
    const isPending = !isSent && !isDue
    const due = state.dueDates[stage] ? new Date(state.dueDates[stage]) : null
    const disabled = paused || isSent || busy !== null

    return (
      <button
        type="button"
        onClick={() => openSendModal(stage)}
        disabled={disabled}
        title={
          isSent
            ? `Sent on ${data.history.find((h) => h.stage === stage)?.sentAt ? new Date(data.history.find((h) => h.stage === stage)!.sentAt!).toLocaleDateString() : ''}`
            : paused
              ? 'Cadence paused'
              : isDue
                ? 'Stage is due — send the follow-up'
                : due
                  ? `Scheduled for ${fmtDate(due)}`
                  : ''
        }
        className={[
          'flex-1 min-w-[160px] text-left px-4 py-3 rounded-lg border transition',
          isSent
            ? 'bg-zinc-800/50 border-zinc-800 text-zinc-500 cursor-not-allowed'
            : isDue
              ? 'bg-amber-600/15 border-amber-500/60 text-white hover:bg-amber-600/25'
              : isPending
                ? 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-750 hover:border-zinc-600'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400',
          disabled && !isSent ? 'opacity-60 cursor-not-allowed' : '',
        ].join(' ')}
      >
        <div className="text-xs font-semibold uppercase tracking-wide">
          {STAGE_LABEL[stage]}
          {isSent && <span className="ml-2 text-emerald-400 normal-case tracking-normal">· sent</span>}
          {isDue && !isSent && <span className="ml-2 text-amber-300 normal-case tracking-normal">· due</span>}
        </div>
        <div className="text-xs text-zinc-500 mt-1 leading-snug">{STAGE_BLURB[stage]}</div>
        {due && !isSent && (
          <div className="text-xs text-zinc-400 mt-1">
            {fmtDate(due)} <span className="text-zinc-600">({fmtRelative(due, now)})</span>
          </div>
        )}
      </button>
    )
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-white">Quote follow-up</h2>
          <div className={`text-xs mt-0.5 font-medium ${statusTone}`}>{statusLine}</div>
        </div>
        <button
          type="button"
          onClick={handleResend}
          disabled={busy !== null}
          className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
          title="Send the original quote email again (re-uses the branded composer)"
        >
          {busy === 'resend' ? 'Resending…' : 'Resend quote email'}
        </button>
      </div>

      {/* Sent / elapsed / valid-until strip */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
        <div>
          <div className="text-zinc-500 uppercase tracking-wide">Sent</div>
          <div className="text-zinc-200 mt-0.5">
            {sentAt ? sentAt.toLocaleDateString() : '—'}
            {sentAt && <span className="text-zinc-500"> · {fmtDays(sentAt, now)}d ago</span>}
          </div>
        </div>
        <div>
          <div className="text-zinc-500 uppercase tracking-wide">Valid until</div>
          <div className="text-zinc-200 mt-0.5">
            {expiresAt ? expiresAt.toLocaleDateString() : '—'}
            {expiresAt && (
              <span className="text-zinc-500"> · {fmtRelative(expiresAt, now)}</span>
            )}
          </div>
        </div>
        {data.threadLastInboundAt && (
          <div>
            <div className="text-zinc-500 uppercase tracking-wide">Last inbound</div>
            <div className="text-emerald-400 mt-0.5">
              {new Date(data.threadLastInboundAt).toLocaleDateString()}{' '}
              <span className="text-zinc-500">({fmtRelative(new Date(data.threadLastInboundAt), now)})</span>
            </div>
          </div>
        )}
      </div>

      {/* Stage buttons */}
      <div className="flex flex-wrap gap-3">
        <StageButton stage="STAGE_1" />
        <StageButton stage="STAGE_2" />
        <StageButton stage="STAGE_3" />
      </div>

      {feedback && (
        <div
          className={`text-xs px-3 py-2 rounded ${
            feedback.kind === 'ok'
              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
              : 'bg-red-500/10 text-red-300 border border-red-500/30'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Send modal */}
      {modalStage && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">Send {STAGE_LABEL[modalStage]}</h3>
              <button
                type="button"
                onClick={() => setModalStage(null)}
                disabled={busy !== null}
                className="text-zinc-500 hover:text-white text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p className="text-xs text-zinc-400 mb-4">{STAGE_BLURB[modalStage]}</p>
            <p className="text-xs text-zinc-500 mb-3">
              The branded follow-up email goes out from the agent on file. You can add an optional note below
              — it gets inserted into the body above the standard close.
            </p>
            <textarea
              value={modalMessage}
              onChange={(e) => setModalMessage(e.target.value)}
              placeholder="Optional message (e.g. 'Just spoke to Production — they're shifting dates to next week, here's the updated quote.')"
              rows={4}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white resize-y"
              disabled={busy !== null}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setModalStage(null)}
                disabled={busy !== null}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSendFollowUp}
                disabled={busy !== null}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
              >
                {busy === modalStage ? 'Sending…' : `Send ${STAGE_LABEL[modalStage]}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
