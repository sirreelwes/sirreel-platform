'use client'
/**
 * The people at a partner, HQ side — the Portals tab's half of the contacts
 * section (Wes 2026-09-11: "I need to be able to add people on the partner
 * portal. owners and others").
 *
 * The partner keeps the same list from their own page; both write through
 * lib/sub-rentals/vendorContacts.ts, so the rules can't drift. The main
 * contact is the address on file — marking someone here changes where every
 * partner email goes.
 */
import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Mail, Phone, Trash2, UserPlus } from 'lucide-react'

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
  addedByPartner: boolean
}

const ROLES = [
  { key: 'OWNER', label: 'Owner' },
  { key: 'ACCOUNTING', label: 'Accounting' },
  { key: 'DISPATCH', label: 'Dispatch' },
  { key: 'SALES', label: 'Sales' },
  { key: 'OPERATIONS', label: 'Operations' },
  { key: 'OTHER', label: 'Other' },
]

const blank = { name: '', email: '', phone: '', role: 'OTHER', notes: '', isPrimary: false, emailBookings: false }
const field = 'text-xs border border-lt-hairline rounded-md px-2 py-1.5 bg-lt-card text-lt-fg'

export function VendorContactsPanel({ vendorId }: { vendorId: string }) {
  const [rows, setRows] = useState<Contact[] | null>(null)
  const [draft, setDraft] = useState({ ...blank })
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/vendors/${vendorId}/contacts`)
      .then((r) => r.json())
      .then((j) => setRows(Array.isArray(j.contacts) ? j.contacts : []))
      .catch(() => setRows([]))
  }, [vendorId])
  useEffect(load, [load])

  async function save() {
    setBusy(true); setMsg(null)
    try {
      const url = editing ? `/api/vendors/${vendorId}/contacts/${editing}` : `/api/vendors/${vendorId}/contacts`
      const r = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save')
      setDraft({ ...blank }); setAdding(false); setEditing(null)
      setMsg(draft.isPrimary ? 'Saved — partner mail now goes to them.' : 'Saved.')
      load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save')
    } finally { setBusy(false) }
  }

  async function remove(c: Contact) {
    if (!window.confirm(`Take ${c.name} off ${'this partner'}’s contacts?`)) return
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/vendors/${vendorId}/contacts/${c.id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not remove')
      setMsg(`${c.name} removed.`)
      load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not remove')
    } finally { setBusy(false) }
  }

  const form = (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <input className={field} placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      <input className={field} placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
      <input className={field} placeholder="Phone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
      <select className={field} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
        {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
      </select>
      <input className={`${field} sm:col-span-2`} placeholder="Note (optional)" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
      <label className="text-xs text-lt-fg2 flex items-center gap-2 sm:col-span-2">
        <input type="checkbox" checked={draft.isPrimary} onChange={(e) => setDraft({ ...draft, isPrimary: e.target.checked })} />
        Main contact — every partner email goes to this address
      </label>
      <label className="text-xs text-lt-fg2 flex items-center gap-2 sm:col-span-2">
        <input type="checkbox" checked={draft.emailBookings} onChange={(e) => setDraft({ ...draft, emailBookings: e.target.checked })} />
        Copy on bookings — estimates, hold requests, it&apos;s-a-go, cancellations, logistics
      </label>
      <div className="flex items-center gap-2 sm:col-span-2">
        <button onClick={save} disabled={busy} className="inline-flex items-center gap-1 text-[11px] font-semibold border border-lt-hairline rounded-md px-2 py-1 text-lt-fg disabled:opacity-40">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} {editing ? 'Save' : 'Add'}
        </button>
        <button onClick={() => { setAdding(false); setEditing(null); setDraft({ ...blank }); setMsg(null) }} className="text-[11px] text-lt-fg3 underline">Cancel</button>
      </div>
    </div>
  )

  return (
    <div className="border border-lt-hairline rounded-lg p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-lt-fg"><UserPlus className="w-4 h-4 text-lt-fg3" /> Their people</div>
      <div className="text-xs text-lt-fg2 mt-1">
        Owner, accounting, dispatch — whoever you deal with. The partner keeps the same list on their page. The main contact is the
        address every partner email goes to.
      </div>

      {rows === null ? (
        <div className="text-xs text-lt-fg3 mt-2">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-lt-fg3 mt-2">Nobody on file yet.</div>
      ) : (
        <div className="mt-2 divide-y divide-lt-hairline">
          {rows.map((c) => (
            <div key={c.id} className="py-2 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm text-lt-fg">
                  {c.name} <span className="text-lt-fg3">· {c.roleLabel}</span>
                  {c.isPrimary && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-chip-good-bg text-chip-good-fg align-middle">main contact</span>}
                  {c.emailBookings && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-chip-warn-bg text-chip-warn-fg align-middle">copied on bookings</span>}
                  {c.addedByPartner && <span className="ml-2 text-[10px] text-lt-fg3 align-middle">added by them</span>}
                </div>
                <div className="text-xs text-lt-fg2 flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                  {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-lt-fg"><Mail className="w-3.5 h-3.5" /> {c.email}</a>}
                  {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 hover:text-lt-fg"><Phone className="w-3.5 h-3.5" /> {c.phone}</a>}
                  {!c.email && !c.phone && <span className="text-lt-fg3">no email or phone</span>}
                </div>
                {c.notes && <div className="text-[11px] text-lt-fg3 mt-0.5">{c.notes}</div>}
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  onClick={() => { setDraft({ name: c.name, email: c.email ?? '', phone: c.phone ?? '', role: c.role, notes: c.notes ?? '', isPrimary: c.isPrimary, emailBookings: c.emailBookings }); setEditing(c.id); setAdding(false); setMsg(null) }}
                  className="text-lt-fg2 hover:text-lt-fg underline"
                >
                  Edit
                </button>
                {!c.isPrimary && (
                  <button onClick={() => remove(c)} className="inline-flex items-center gap-1 text-lt-fg3 hover:text-chip-bad-fg">
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing || adding ? form : (
        <button
          onClick={() => { setAdding(true); setDraft({ ...blank }); setMsg(null) }}
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold border border-lt-hairline rounded-md px-2 py-1 text-lt-fg"
        >
          <UserPlus className="w-3 h-3" /> Add a person
        </button>
      )}
      {msg && <div className="text-xs text-lt-fg2 mt-2">{msg}</div>}
    </div>
  )
}
