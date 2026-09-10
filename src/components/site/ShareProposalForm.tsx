'use client'
/**
 * The partner counter-offers on the DEAL — the split itself, not a unit rate.
 *
 * Wes 2026-09-10, before PowerTrip's agreement goes to Evan: give him the
 * chance to come back with a different number rather than take 20% or walk.
 *
 * The partner types THEIR OWN percentage. Asking someone to counter-offer in
 * terms of the other side's cut is how you end up with an 80/20 deal by
 * accident — and their number is the one already in big type above this form.
 * The conversion to SirReel's share happens once, server-side.
 *
 * Like UnitRateForm this is a PROPOSAL: nothing about billing moves until HQ
 * accepts on the Portals tab, and the form says so plainly.
 */
import { useState } from 'react'

export function ShareProposalForm({ token, preview, currentSirReelPercent, proposed, rateNoun }: {
  token: string
  preview: boolean
  /** SirReel's standing share, or null when HQ hasn't set the deal yet. */
  currentSirReelPercent: number | null
  /** A pending ask, as SirReel's share (that is how it is stored). */
  proposed: { sirreelPercent: number; at: string; note: string | null } | null
  /** "vehicle rental rate" / "rental rate" — from partnerVocab. */
  rateNoun: string
}) {
  const toPartner = (sirreel: number) => Math.round((100 - sirreel) * 100) / 100
  const [open, setOpen] = useState(false)
  const [v, setV] = useState({
    partnerPercent: proposed ? toPartner(proposed.sirreelPercent).toString() : '',
    note: proposed?.note ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, setPending] = useState(proposed)

  const box: React.CSSProperties = { padding: '6px 8px', border: '1px solid #d6d1c4', borderRadius: 8, fontSize: 13, color: '#111', background: '#fff' }

  const typed = v.partnerPercent === '' ? null : Number(v.partnerPercent)
  const valid = typed != null && Number.isFinite(typed) && typed >= 0 && typed <= 100

  async function send() {
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await fetch(`/api/public/vendor-account/${token}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerPercent: v.partnerPercent, note: v.note }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Could not send')
      setPending({ sirreelPercent: Math.round((100 - Number(v.partnerPercent)) * 100) / 100, at: new Date().toISOString(), note: v.note || null })
      setOpen(false)
      setMsg('Sent to SirReel. We’ll come back to you by email.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send')
    } finally { setBusy(false) }
  }

  return (
    <div style={{ marginTop: 10 }}>
      {pending && !open && (
        <div style={{ fontSize: 12, color: '#8a6d1f', background: '#fbf3df', borderRadius: 6, padding: '4px 8px', display: 'inline-block' }}>
          You asked for {toPartner(pending.sirreelPercent)}% / {pending.sirreelPercent}% · awaiting SirReel
        </div>
      )}
      {msg && <div style={{ fontSize: 12, color: '#2f7d5d', marginTop: 4 }}>{msg}</div>}

      {!open ? (
        <button
          type="button"
          disabled={preview}
          onClick={() => setOpen(true)}
          style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: '#111', background: 'none', border: '1px solid #d6d1c4', borderRadius: 6, padding: '4px 10px', cursor: preview ? 'default' : 'pointer', opacity: preview ? 0.5 : 1 }}
        >
          {pending ? 'Change what you asked for' : 'Propose a different split'}
        </button>
      ) : (
        <div style={{ marginTop: 8, display: 'grid', gap: 8, maxWidth: 460 }}>
          <label style={{ fontSize: 12, color: '#6b6560', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>You keep</span>
            <input
              style={{ ...box, width: 80 }}
              inputMode="decimal"
              placeholder="%"
              aria-label="the percentage you keep"
              value={v.partnerPercent}
              onChange={(e) => setV({ ...v, partnerPercent: e.target.value })}
            />
            <span>% of the {rateNoun}</span>
            {valid && (
              <span style={{ color: '#111' }}>
                — SirReel keeps <strong>{Math.round((100 - typed!) * 100) / 100}%</strong>
                {currentSirReelPercent != null && <span style={{ color: '#8a8272' }}> (now {currentSirReelPercent}%)</span>}
              </span>
            )}
          </label>
          <input
            style={{ ...box, width: '100%' }}
            placeholder="Why (optional) — what makes this work for you"
            value={v.note}
            onChange={(e) => setV({ ...v, note: e.target.value })}
          />
          <div style={{ fontSize: 11, color: '#8a8272' }}>
            This is a proposal — your current split stays in force, and nothing on a booking changes, until SirReel accepts.
          </div>
          {err && <div style={{ fontSize: 12, color: '#a33a2e' }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={busy || !valid} onClick={send} style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: '#0c0c0d', border: 0, borderRadius: 8, padding: '7px 12px', cursor: busy || !valid ? 'default' : 'pointer', opacity: busy || !valid ? 0.5 : 1 }}>
              {busy ? 'Sending…' : 'Send proposal'}
            </button>
            <button type="button" onClick={() => { setOpen(false); setErr(null) }} style={{ fontSize: 13, color: '#6b6560', background: 'none', border: 0, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
