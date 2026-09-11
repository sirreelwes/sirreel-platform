'use client'
/**
 * The partner's own people — owner, accounting, dispatch, whoever else.
 *
 * Wes 2026-09-11: "I need to be able to add people on the partner portal.
 * owners and others. let's have a contacts section." HQ keeps the same list
 * from the Portals panel; this is the partner's side of it. Inert in the HQ
 * preview, like every other control on this page.
 */
import { useCallback, useEffect, useState } from 'react'

interface Contact {
  id: string
  name: string
  email: string | null
  phone: string | null
  role: string
  roleLabel: string
  notes: string | null
  isPrimary: boolean
  emailBookings: boolean
}

const ROLES = [
  { key: 'OWNER', label: 'Owner' },
  { key: 'ACCOUNTING', label: 'Accounting' },
  { key: 'DISPATCH', label: 'Dispatch' },
  { key: 'SALES', label: 'Sales' },
  { key: 'OPERATIONS', label: 'Operations' },
  { key: 'OTHER', label: 'Other' },
]

const INPUT: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #d6d1c4', borderRadius: 8, fontSize: 14, color: '#111', background: '#fff' }
const BTN: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#fff', background: '#0c0c0d', border: 0, borderRadius: 8, padding: '8px 14px', cursor: 'pointer' }
const LINK: React.CSSProperties = { fontSize: 13, color: '#6b6560', background: 'none', border: 0, cursor: 'pointer', padding: 0 }
const CHIP: React.CSSProperties = { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#eef4f2', color: '#2f7d5d' }

const blank = { name: '', email: '', phone: '', role: 'OTHER', notes: '', isPrimary: false, emailBookings: false }

export function VendorContactsCard({ token, preview }: { token: string; preview: boolean }) {
  const [rows, setRows] = useState<Contact[] | null>(null)
  const [draft, setDraft] = useState({ ...blank })
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/public/vendor-account/${token}/contacts`)
      .then((r) => r.json())
      .then((j) => setRows(Array.isArray(j.contacts) ? j.contacts : []))
      .catch(() => setRows([]))
  }, [token])
  useEffect(load, [load])

  async function save(url: string, method: 'POST' | 'PATCH') {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save')
      setDraft({ ...blank }); setAdding(false); setEditing(null); setMsg('Saved — thank you.')
      load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save')
    } finally { setBusy(false) }
  }

  async function remove(c: Contact) {
    if (!window.confirm(`Take ${c.name} off your contacts?`)) return
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/public/vendor-account/${token}/contacts/${c.id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not remove')
      setMsg(`${c.name} removed.`)
      load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not remove')
    } finally { setBusy(false) }
  }

  function startEdit(c: Contact) {
    setDraft({ name: c.name, email: c.email ?? '', phone: c.phone ?? '', role: c.role, notes: c.notes ?? '', isPrimary: c.isPrimary, emailBookings: c.emailBookings })
    setEditing(c.id); setAdding(false); setMsg(null)
  }

  const form = (
    <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
      <input style={INPUT} placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      <input style={INPUT} placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
      <input style={INPUT} placeholder="Phone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
      <select style={INPUT} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
        {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
      </select>
      <input style={INPUT} placeholder="Anything we should know (optional)" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
      <label style={{ fontSize: 13, color: '#3d392f', display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={draft.isPrimary} onChange={(e) => setDraft({ ...draft, isPrimary: e.target.checked })} />
        Main contact — SirReel’s mail for {"your"} account goes here
      </label>
      <label style={{ fontSize: 13, color: '#3d392f', display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={draft.emailBookings} onChange={(e) => setDraft({ ...draft, emailBookings: e.target.checked })} />
        Copy them on bookings — estimates, holds, go-aheads, cancellations
      </label>
      {msg && <div style={{ fontSize: 12, color: '#a33' }}>{msg}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          disabled={busy}
          style={BTN}
          onClick={() => (editing
            ? save(`/api/public/vendor-account/${token}/contacts/${editing}`, 'PATCH')
            : save(`/api/public/vendor-account/${token}/contacts`, 'POST'))}
        >
          {busy ? 'Saving…' : editing ? 'Save' : 'Add them'}
        </button>
        <button type="button" style={LINK} onClick={() => { setAdding(false); setEditing(null); setDraft({ ...blank }); setMsg(null) }}>Cancel</button>
      </div>
    </div>
  )

  return (
    <section style={{ background: '#fff', border: '1px solid #e2ddd0', borderRadius: 12, padding: 18, marginTop: 14 }}>
      <div style={{ fontSize: 11, letterSpacing: '1.4px', textTransform: 'uppercase', color: '#8a8272', fontWeight: 700, margin: '0 0 6px' }}>Your people</div>
      <div style={{ fontSize: 13, color: '#6b6560', marginBottom: 10 }}>
        Who we should know at {"your"} company — owner, accounting, dispatch. Mark the one SirReel should write to, and tick anyone who
        should be copied on bookings.
      </div>

      {rows === null ? (
        <div style={{ fontSize: 14, color: '#8a8272' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 14, color: '#6b6560' }}>Nobody added yet.</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((c) => (
            <div key={c.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'baseline', justifyContent: 'space-between', borderTop: '1px solid #f0ece2', paddingTop: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>
                  {c.name}
                  <span style={{ fontWeight: 400, color: '#6b6560' }}> · {c.roleLabel}</span>
                </div>
                <div style={{ fontSize: 13, color: '#3d392f' }}>{c.email ?? 'no email'}{c.phone ? ` · ${c.phone}` : ''}</div>
                {c.notes && <div style={{ fontSize: 12, color: '#8a8272' }}>{c.notes}</div>}
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  {c.isPrimary && <span style={CHIP}>main contact</span>}
                  {c.emailBookings && <span style={{ ...CHIP, background: '#f4f0e6', color: '#8a6d1f' }}>copied on bookings</span>}
                </div>
              </div>
              {!preview && (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="button" style={LINK} onClick={() => startEdit(c)}>Edit</button>
                  {!c.isPrimary && <button type="button" style={LINK} onClick={() => remove(c)}>Remove</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing || adding ? form : (
        <button
          type="button"
          disabled={preview}
          onClick={() => { setAdding(true); setDraft({ ...blank }); setMsg(null) }}
          style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: '#111', background: 'none', border: '1px solid #d6d1c4', borderRadius: 8, padding: '6px 12px', cursor: preview ? 'default' : 'pointer', opacity: preview ? 0.5 : 1 }}
        >
          Add a person
        </button>
      )}
      {msg && !editing && !adding && <div style={{ fontSize: 12, color: '#2f7d5d', marginTop: 8 }}>{msg}</div>}
    </section>
  )
}
