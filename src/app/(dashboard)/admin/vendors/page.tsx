'use client'

/**
 * Vendors admin — list / add / edit / archive surface for the shared
 * `Vendor` table that powers both sub-rentals and inventory reorder.
 * Same auth gate as POST /api/vendors and PATCH /api/vendors/[id]
 * (requireSubRentalAccess: AGENT + MANAGER + ADMIN — deliberately
 * broader than requireAdmin so reps can quick-create vendors from the
 * SubRentalModal picker). Pickers elsewhere filter archived vendors
 * out; this page can flip the toggle to show them.
 *
 * Sub-rental Phase A added the roster fields (address, poEmail,
 * supplies, deliveryTerms) that later PO / shortfall-sourcing / margin
 * phases build on. No PO or margin logic lives here.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

type Vendor = {
  id: string
  name: string
  contactName: string | null
  email: string | null
  phone: string | null
  website: string | null
  notes: string | null
  address: string | null
  poEmail: string | null
  supplies: string | null
  deliveryTerms: string | null
  effectivePoEmail: string | null
  isActive: boolean
  _count?: { subRentals: number; inventoryItems: number }
}

// Editable string fields (everything except id / isActive / counts).
type EditableField =
  | 'name' | 'contactName' | 'email' | 'phone' | 'website'
  | 'poEmail' | 'supplies' | 'address' | 'deliveryTerms' | 'notes'

const EMPTY_FORM: Record<EditableField, string> = {
  name: '', contactName: '', email: '', phone: '', website: '',
  poEmail: '', supplies: '', address: '', deliveryTerms: '', notes: '',
}

const inputCls =
  'w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500'
const labelCls =
  'block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1'

export default function AdminVendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [search, setSearch] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Record<EditableField, string>>(EMPTY_FORM)

  const [newValues, setNewValues] = useState<Record<EditableField, string>>(EMPTY_FORM)
  const [showAdd, setShowAdd] = useState(false)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const url = showArchived ? '/api/vendors?includeArchived=1' : '/api/vendors'
    const res = await fetch(url)
    if (res.status === 401) { setError('Sign in required.'); setLoading(false); return }
    if (res.status === 403) { setError('Forbidden — manager/admin only.'); setLoading(false); return }
    const data = await res.json().catch(() => ({}))
    setVendors(data.vendors || [])
    setLoading(false)
  }, [showArchived])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return vendors
    return vendors.filter((v) =>
      v.name.toLowerCase().includes(q) ||
      (v.supplies ?? '').toLowerCase().includes(q),
    )
  }, [vendors, search])

  const setNew = (f: EditableField, val: string) => setNewValues((s) => ({ ...s, [f]: val }))
  const setEdit = (f: EditableField, val: string) => setEditValues((s) => ({ ...s, [f]: val }))

  const startEdit = (v: Vendor) => {
    setEditingId(v.id)
    setEditValues({
      name: v.name,
      contactName: v.contactName ?? '',
      email: v.email ?? '',
      phone: v.phone ?? '',
      website: v.website ?? '',
      poEmail: v.poEmail ?? '',
      supplies: v.supplies ?? '',
      address: v.address ?? '',
      deliveryTerms: v.deliveryTerms ?? '',
      notes: v.notes ?? '',
    })
  }

  const saveEdit = async (id: string) => {
    const res = await fetch(`/api/vendors/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editValues),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { alert(d.error || `Save failed (HTTP ${res.status})`); return }
    setEditingId(null)
    load()
  }

  const setArchived = async (id: string, archived: boolean) => {
    const verb = archived ? 'Archive' : 'Restore'
    if (!confirm(`${verb} this vendor?`)) return
    const res = await fetch(`/api/vendors/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !archived }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      alert(d.error || `${verb} failed`)
      return
    }
    load()
  }

  const createVendor = async () => {
    if (!newValues.name.trim()) return
    setCreating(true)
    const res = await fetch('/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newValues),
    })
    const d = await res.json().catch(() => ({}))
    setCreating(false)
    if (!res.ok) { alert(d.error || `Create failed (HTTP ${res.status})`); return }
    setNewValues(EMPTY_FORM)
    setShowAdd(false)
    load()
  }

  // Shared field grid used by both the add form and the inline editor.
  const FieldGrid = ({
    values, onChange,
  }: {
    values: Record<EditableField, string>
    onChange: (f: EditableField, v: string) => void
  }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      <div>
        <label className={labelCls}>Name <span className="text-amber-500">*</span></label>
        <input type="text" value={values.name} onChange={(e) => onChange('name', e.target.value)} placeholder="e.g. AbelCine" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Supplies / categories</label>
        <input type="text" value={values.supplies} onChange={(e) => onChange('supplies', e.target.value)} placeholder="e.g. grip, dolly, lighting" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Website</label>
        <input type="url" value={values.website} onChange={(e) => onChange('website', e.target.value)} placeholder="https://…" className={`${inputCls} font-mono`} />
      </div>
      <div>
        <label className={labelCls}>Contact name</label>
        <input type="text" value={values.contactName} onChange={(e) => onChange('contactName', e.target.value)} placeholder="Rep / desk" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Contact email</label>
        <input type="email" value={values.email} onChange={(e) => onChange('email', e.target.value)} placeholder="rep@vendor.com" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Phone</label>
        <input type="tel" value={values.phone} onChange={(e) => onChange('phone', e.target.value)} placeholder="(555) 123-4567" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>PO email <span className="text-zinc-600 normal-case tracking-normal">(falls back to contact email)</span></label>
        <input type="email" value={values.poEmail} onChange={(e) => onChange('poEmail', e.target.value)} placeholder="orders@vendor.com" className={inputCls} />
      </div>
      <div className="lg:col-span-2">
        <label className={labelCls}>Address</label>
        <input type="text" value={values.address} onChange={(e) => onChange('address', e.target.value)} placeholder="Street, city, state" className={inputCls} />
      </div>
      <div className="md:col-span-2 lg:col-span-3">
        <label className={labelCls}>Delivery terms</label>
        <input type="text" value={values.deliveryTerms} onChange={(e) => onChange('deliveryTerms', e.target.value)} placeholder="Lead time, cutoffs, dock hours…" className={inputCls} />
      </div>
      <div className="md:col-span-2 lg:col-span-3">
        <label className={labelCls}>Notes</label>
        <input type="text" value={values.notes} onChange={(e) => onChange('notes', e.target.value)} placeholder="Account #, misc." className={inputCls} />
      </div>
    </div>
  )

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">Vendors</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Reusable vendor records — shared by sub-rentals and inventory reorder routing.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-600"
            />
            Show archived
          </label>
          <button
            type="button"
            onClick={() => setShowAdd((s) => !s)}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-lg"
          >
            {showAdd ? 'Close' : '+ Add vendor'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800/40 text-red-200 rounded-lg p-3 text-sm mb-4">
          {error}
        </div>
      )}

      {/* Add vendor form — collapsible */}
      {showAdd && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
          <h2 className="text-sm font-semibold text-white mb-3">Add vendor</h2>
          <FieldGrid values={newValues} onChange={setNew} />
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setNewValues(EMPTY_FORM); setShowAdd(false) }}
              className="px-4 py-2 text-zinc-400 hover:text-white text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={createVendor}
              disabled={creating || !newValues.name.trim()}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-semibold rounded-lg"
            >
              {creating ? 'Adding…' : 'Add vendor'}
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or supplies…"
          className="w-full md:max-w-sm px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500"
        />
      </div>

      {/* List table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400 text-left text-xs uppercase tracking-wide">
              <th className="px-3 py-3 font-medium">Name</th>
              <th className="px-3 py-3 font-medium">Supplies</th>
              <th className="px-3 py-3 font-medium">PO email</th>
              <th className="px-3 py-3 font-medium">Contact</th>
              <th className="px-3 py-3 font-medium text-center">Sub-rentals</th>
              <th className="px-3 py-3 font-medium text-center">Inventory</th>
              <th className="px-3 py-3 font-medium text-right w-[160px]"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-zinc-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-zinc-500">
                {search.trim() ? 'No vendors match your search.' : 'No vendors yet — add one above.'}
              </td></tr>
            ) : filtered.map((v) => {
              const isEditing = editingId === v.id
              const archived = !v.isActive
              return (
                <Fragment key={v.id}>
                  <tr
                    className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${archived ? 'opacity-60' : ''}`}
                  >
                    <td className="px-3 py-2 text-sm">
                      <span className={`font-semibold ${archived ? 'text-zinc-500' : 'text-white'}`}>
                        {v.name}
                        {archived && <span className="ml-2 text-[10px] uppercase tracking-wider text-zinc-500">archived</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-300">
                      {v.supplies || <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-400 font-mono">
                      {v.effectivePoEmail
                        ? <span className={v.poEmail ? '' : 'italic text-zinc-500'} title={v.poEmail ? 'PO email' : 'falling back to contact email'}>{v.effectivePoEmail}</span>
                        : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-400">
                      <span className="truncate inline-block max-w-[16rem] align-middle" title={[v.contactName, v.email, v.phone].filter(Boolean).join(' · ')}>
                        {[v.contactName, v.email, v.phone].filter(Boolean).join(' · ') || <span className="text-zinc-600">—</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-center text-zinc-300 font-mono">{v._count?.subRentals ?? 0}</td>
                    <td className="px-3 py-2 text-xs text-center text-zinc-300 font-mono">{v._count?.inventoryItems ?? 0}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => (isEditing ? setEditingId(null) : startEdit(v))} className="text-zinc-500 hover:text-blue-400 text-xs mr-2">
                        {isEditing ? 'Close' : 'Edit'}
                      </button>
                      <button
                        onClick={() => setArchived(v.id, !archived)}
                        className={`text-xs ${archived ? 'text-emerald-400 hover:text-emerald-300' : 'text-zinc-500 hover:text-red-400'}`}
                      >
                        {archived ? 'Restore' : 'Archive'}
                      </button>
                    </td>
                  </tr>
                  {isEditing && (
                    <tr className="border-b border-zinc-800/50 bg-zinc-950/40">
                      <td colSpan={7} className="px-4 py-4">
                        <FieldGrid values={editValues} onChange={setEdit} />
                        <div className="mt-4 flex justify-end gap-2">
                          <button onClick={() => setEditingId(null)} className="px-4 py-2 text-zinc-400 hover:text-white text-sm">Cancel</button>
                          <button onClick={() => saveEdit(v.id)} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg">Save changes</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
