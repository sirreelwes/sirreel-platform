'use client'
/** The partner edits their own contact details. Inert in the HQ preview. */
import { useState } from 'react'

export function VendorContactForm({ token, preview, initial }: {
  token: string
  preview: boolean
  initial: { contactName: string | null; email: string | null; phone: string | null; lotAddress: string | null }
}) {
  const [v, setV] = useState({ contactName: initial.contactName ?? '', email: initial.email ?? '', phone: initial.phone ?? '', lotAddress: initial.lotAddress ?? '' })
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const inp = 'width:100%;padding:8px 10px;border:1px solid #d6d1c4;border-radius:8px;font-size:14px;color:#111;background:#fff'
  async function save() {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/public/vendor-account/${token}/contact`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Could not save')
      setMsg('Saved — thank you.'); setEditing(false)
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not save') } finally { setBusy(false) }
  }
  if (!editing) {
    return (
      <div>
        <div style={{ fontSize: 14, color: '#111', lineHeight: 1.6 }}>
          <div>{v.contactName || <span style={{ color: '#8a8272' }}>No contact name on file</span>}</div>
          <div style={{ color: '#3d392f' }}>{v.email || '—'}{v.phone ? ` · ${v.phone}` : ''}</div>
          <div style={{ color: '#6b6560', fontSize: 13 }}>{v.lotAddress ? `Lot: ${v.lotAddress}` : 'No lot address on file'}</div>
        </div>
        {msg && <div style={{ fontSize: 12, color: '#2f7d5d', marginTop: 6 }}>{msg}</div>}
        <button type="button" disabled={preview} onClick={() => setEditing(true)} style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: '#111', background: 'none', border: '1px solid #d6d1c4', borderRadius: 8, padding: '6px 12px', cursor: preview ? 'default' : 'pointer', opacity: preview ? 0.5 : 1 }}>
          Update contact details
        </button>
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <input style={{ ...cssObj(inp) }} placeholder="Contact name" value={v.contactName} onChange={(e) => setV({ ...v, contactName: e.target.value })} />
      <input style={{ ...cssObj(inp) }} placeholder="Email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
      <input style={{ ...cssObj(inp) }} placeholder="Phone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
      <textarea style={{ ...cssObj(inp), minHeight: 60 }} placeholder="Lot address — where units leave from" value={v.lotAddress} onChange={(e) => setV({ ...v, lotAddress: e.target.value })} />
      {msg && <div style={{ fontSize: 12, color: '#a33' }}>{msg}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={busy} onClick={save} style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: '#0c0c0d', border: 0, borderRadius: 8, padding: '8px 14px', cursor: 'pointer' }}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={() => setEditing(false)} style={{ fontSize: 13, color: '#6b6560', background: 'none', border: 0, cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  )
}

function cssObj(s: string): React.CSSProperties {
  const o: Record<string, string> = {}
  for (const part of s.split(';')) { const [k, val] = part.split(':'); if (k && val) o[k.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val.trim() }
  return o as React.CSSProperties
}
