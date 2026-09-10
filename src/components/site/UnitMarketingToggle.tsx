'use client'
/** The partner's switch on whether SirReel may offer this unit to clients —
 *  agreement clause 10, revocable at any time. Withdrawing takes effect on
 *  the next page render of sirreel.com. */
import { useState } from 'react'

export function UnitMarketingToggle({ token, unitId, preview, initial, noun = 'vehicle' }: { token: string; unitId: string; preview: boolean; initial: boolean; /** "vehicle" for a vehicle partner, "unit" for an equipment one. */ noun?: string }) {
  const [allowed, setAllowed] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function flip() {
    const next = !allowed
    if (!next && !window.confirm(`Withdraw permission to market this ${noun}? SirReel stops offering it to productions right away. Bookings already confirmed are not affected.`)) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/public/vendor-account/${token}/units/${unitId}/marketing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed: next }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Could not save')
      setAllowed(next)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save') } finally { setBusy(false) }
  }
  return (
    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: allowed ? '#2f7d5d' : '#8a6d1f' }}>
        {allowed ? `SirReel may offer this ${noun} to productions.` : `Withheld — SirReel is not offering this ${noun}.`}
      </span>
      <button type="button" disabled={preview || busy} onClick={flip} style={{ fontSize: 12, fontWeight: 600, color: '#111', background: 'none', border: '1px solid #d6d1c4', borderRadius: 6, padding: '4px 10px', cursor: preview ? 'default' : 'pointer', opacity: preview || busy ? 0.5 : 1 }}>
        {allowed ? 'Withdraw' : 'Allow'}
      </button>
      {err && <span style={{ fontSize: 12, color: '#b4503a' }}>{err}</span>}
    </div>
  )
}
