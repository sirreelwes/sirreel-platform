'use client'
/** The partner proposes new list rates on one of their units. It is a
 *  PROPOSAL — nothing changes until SirReel accepts — and the form says so. */
import { useState } from 'react'

export function UnitRateForm({ token, unitId, preview, current, proposed }: {
  token: string
  unitId: string
  preview: boolean
  current: { daily: number | null; weekly: number | null; monthly: number | null }
  proposed: { daily: number | null; weekly: number | null; monthly: number | null; at: string; note: string | null } | null
}) {
  const [open, setOpen] = useState(false)
  const [v, setV] = useState({ daily: proposed?.daily?.toString() ?? '', weekly: proposed?.weekly?.toString() ?? '', monthly: proposed?.monthly?.toString() ?? '', note: proposed?.note ?? '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, setPending] = useState(!!proposed)
  const box: React.CSSProperties = { width: 96, padding: '6px 8px', border: '1px solid #d6d1c4', borderRadius: 8, fontSize: 13, color: '#111', background: '#fff' }
  async function send() {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/public/vendor-account/${token}/units/${unitId}/rate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Could not send')
      setPending(true); setOpen(false); setMsg('Sent to SirReel for review.')
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not send') } finally { setBusy(false) }
  }
  const money = (n: number | null) => (n == null ? '—' : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`)
  return (
    <div style={{ marginTop: 6 }}>
      {pending && !open && (
        <div style={{ fontSize: 12, color: '#8a6d1f', background: '#fbf3df', borderRadius: 6, padding: '4px 8px', display: 'inline-block' }}>
          New rates proposed · awaiting SirReel
        </div>
      )}
      {msg && <div style={{ fontSize: 12, color: '#2f7d5d', marginTop: 4 }}>{msg}</div>}
      {!open ? (
        <div>
          <button type="button" disabled={preview} onClick={() => setOpen(true)} style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: '#111', background: 'none', border: '1px solid #d6d1c4', borderRadius: 6, padding: '4px 10px', cursor: preview ? 'default' : 'pointer', opacity: preview ? 0.5 : 1 }}>
            {pending ? 'Change the proposal' : 'Propose new rates'}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
            {(['daily', 'weekly', 'monthly'] as const).map((k) => (
              <label key={k} style={{ fontSize: 11, color: '#6b6560', display: 'grid', gap: 3 }}>
                <span>{k} · now {money(current[k])}</span>
                <input style={box} inputMode="decimal" placeholder="$" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          <input style={{ ...box, width: '100%' }} placeholder="Why (optional) — e.g. new insurance cost" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
          <div style={{ fontSize: 11, color: '#8a8272' }}>Nothing changes until SirReel accepts. We&apos;ll confirm by email.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={busy} onClick={send} style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: '#0c0c0d', border: 0, borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }}>{busy ? 'Sending…' : 'Send proposal'}</button>
            <button type="button" onClick={() => setOpen(false)} style={{ fontSize: 13, color: '#6b6560', background: 'none', border: 0, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
