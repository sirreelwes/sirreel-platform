'use client'

/**
 * The partner's answer to "please hold" — on their page, not in a reply.
 *
 * Confirm flips the sub-rental to CONFIRMED and tells HQ. "Can't hold" only
 * raises the alarm at HQ: the status is left for a human, because a client
 * is committed on the other side and a partner's click should not silently
 * unwind that.
 */

import { useState } from 'react'

export default function VendorHoldCard({
  token,
  status,
  confirmedAt,
  declinedAt,
  declineNote,
  readOnly = false,
}: {
  token: string
  status: string
  confirmedAt: string | null
  declinedAt: string | null
  declineNote: string | null
  /** HQ preview — render the card, disable the buttons. */
  readOnly?: boolean
}) {
  const [state, setState] = useState<{ status: string; confirmedAt: string | null; declinedAt: string | null; declineNote: string | null }>({
    status, confirmedAt, declinedAt, declineNote,
  })
  const [declining, setDeclining] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function post(action: 'confirm' | 'decline') {
    if (readOnly) return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/public/vendor/${token}/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: action === 'decline' ? note : undefined }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { setError(j.error ?? 'That didn’t go through.'); return }
      if (action === 'confirm') setState((s) => ({ ...s, status: j.status, confirmedAt: j.confirmedAt, declinedAt: null, declineNote: null }))
      else { setState((s) => ({ ...s, declinedAt: j.declinedAt, declineNote: note || null })); setDeclining(false) }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed')
    } finally { setBusy(false) }
  }

  if (!['REQUESTED', 'CONFIRMED', 'PICKED_UP', 'ON_RENT'].includes(state.status)) return null

  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const eyebrow = 'text-[12px] font-semibold tracking-[0.16em] uppercase text-[#8b857a]'

  return (
    <div className="mt-6 rounded-[14px] border border-[#e4dfd4] bg-white p-5">
      <div className={eyebrow} style={{ fontFamily: 'Archivo, sans-serif' }}>The hold</div>

      {error && <div className="mt-3 text-[13px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</div>}

      {state.confirmedAt ? (
        <p className="mt-2 text-[15px] text-[#2f7d5d] font-semibold">
          Confirmed {fmt(state.confirmedAt)} — thank you. We&rsquo;ll follow up with the PO.
        </p>
      ) : state.declinedAt ? (
        <div className="mt-2">
          <p className="text-[15px] text-[#a3452c] font-semibold">You told us you can&rsquo;t hold these dates ({fmt(state.declinedAt)}).</p>
          {state.declineNote && <p className="mt-1 text-[14px] text-[#5a554c]">&ldquo;{state.declineNote}&rdquo;</p>}
          <p className="mt-2 text-[13px] text-[#5a554c]">SirReel has been alerted and will be in touch. If that&rsquo;s changed, you can still confirm below.</p>
          <button onClick={() => post('confirm')} disabled={busy || readOnly}
            className="mt-3 inline-flex items-center rounded-full bg-amber-600 hover:bg-amber-500 text-white px-5 py-2.5 text-[14px] font-bold disabled:opacity-50"
            style={{ fontFamily: 'Archivo, sans-serif' }}>
            {busy ? 'Sending…' : 'Confirm the hold after all'}
          </button>
        </div>
      ) : (
        <>
          <p className="mt-2 text-[14px] text-[#5a554c] leading-relaxed">
            Please confirm you are holding this unit for the dates above. One click here does it — no need to reply to the email.
          </p>
          {!declining ? (
            <div className="mt-4 flex items-center gap-4 flex-wrap">
              <button onClick={() => post('confirm')} disabled={busy || readOnly}
                className="inline-flex items-center rounded-full bg-amber-600 hover:bg-amber-500 text-white px-5 py-2.5 text-[14px] font-bold disabled:opacity-50"
                style={{ fontFamily: 'Archivo, sans-serif' }}>
                {busy ? 'Sending…' : 'Confirm hold'}
              </button>
              <button onClick={() => setDeclining(true)} disabled={busy || readOnly} className="text-[13px] font-semibold text-[#8b857a] hover:text-[#3a362f]">
                We can&rsquo;t hold these dates
              </button>
            </div>
          ) : (
            <div className="mt-4">
              <label className="block text-[12px] font-semibold tracking-[0.1em] uppercase text-[#8b857a] mb-1.5">Tell us why, or what would work</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
                placeholder="e.g. Already committed the 11th — free from the 12th"
                className="w-full border border-[#e4dfd4] rounded-lg px-3 py-2 text-[15px] bg-white focus:outline-none focus:border-[#c39a3f]" />
              <div className="mt-3 flex items-center gap-4">
                <button onClick={() => post('decline')} disabled={busy || readOnly}
                  className="inline-flex items-center rounded-full bg-[#3a362f] hover:bg-[#0c0c0d] text-white px-5 py-2.5 text-[14px] font-bold disabled:opacity-50"
                  style={{ fontFamily: 'Archivo, sans-serif' }}>
                  {busy ? 'Sending…' : 'Send to SirReel'}
                </button>
                <button onClick={() => setDeclining(false)} className="text-[13px] text-[#8b857a] hover:text-[#3a362f]">Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
