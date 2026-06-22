'use client'

/**
 * Vendors admin — minimal list/add/edit/archive surface for the shared
 * `Vendor` table that powers both sub-rentals and inventory reorder.
 * Same auth gate as POST /api/vendors and PATCH /api/vendors/[id]
 * (requireSubRentalAccess: AGENT + MANAGER + ADMIN). Pickers elsewhere
 * filter archived vendors out; this page can flip the toggle to show
 * them.
 */

import { useCallback, useEffect, useState } from 'react'

type Vendor = {
  id: string
  name: string
  contactName: string | null
  email: string | null
  phone: string | null
  website: string | null
  notes: string | null
  isActive: boolean
  _count?: { subRentals: number; inventoryItems: number }
}

export default function AdminVendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Record<string, string>>({})

  // New-vendor row state
  const [newName, setNewName] = useState('')
  const [newWebsite, setNewWebsite] = useState('')
  const [newContact, setNewContact] = useState('')
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

  const startEdit = (v: Vendor) => {
    setEditingId(v.id)
    setEditValues({
      name: v.name,
      website: v.website ?? '',
      contactName: v.contactName ?? '',
      email: v.email ?? '',
      phone: v.phone ?? '',
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
    if (!res.ok) {
      alert(d.error || `Save failed (HTTP ${res.status})`)
      return
    }
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
    if (!newName.trim()) return
    setCreating(true)
    const res = await fetch('/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName.trim(),
        website: newWebsite.trim() || null,
        notes: newContact.trim() || null,
      }),
    })
    const d = await res.json().catch(() => ({}))
    setCreating(false)
    if (!res.ok) {
      alert(d.error || `Create failed (HTTP ${res.status})`)
      return
    }
    setNewName('')
    setNewWebsite('')
    setNewContact('')
    load()
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Vendors</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Reusable vendor records — shared by sub-rentals and inventory reorder routing.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-600"
          />
          Show archived
        </label>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800/40 text-red-200 rounded-lg p-3 text-sm mb-4">
          {error}
        </div>
      )}

      {/* Add vendor row — always at the top */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
        <h2 className="text-sm font-semibold text-white mb-3">Add vendor</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
              Name <span className="text-amber-500">*</span>
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Amazon"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
              Default URL
            </label>
            <input
              type="url"
              value={newWebsite}
              onChange={(e) => setNewWebsite(e.target.value)}
              placeholder="https://…"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white font-mono focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
              Contact / notes
            </label>
            <input
              type="text"
              value={newContact}
              onChange={(e) => setNewContact(e.target.value)}
              placeholder="phone / email / account #"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <button
              type="button"
              onClick={createVendor}
              disabled={creating || !newName.trim()}
              className="w-full px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-semibold rounded-lg"
            >
              {creating ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      </div>

      {/* List table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400 text-left text-xs uppercase tracking-wide">
              <th className="px-3 py-3 font-medium">Name</th>
              <th className="px-3 py-3 font-medium">Default URL</th>
              <th className="px-3 py-3 font-medium">Contact / notes</th>
              <th className="px-3 py-3 font-medium text-center">Sub-rentals</th>
              <th className="px-3 py-3 font-medium text-center">Inventory</th>
              <th className="px-3 py-3 font-medium text-right w-[180px]"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-zinc-500">Loading…</td></tr>
            ) : vendors.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-zinc-500">No vendors yet — add one above.</td></tr>
            ) : vendors.map((v) => {
              const isEditing = editingId === v.id
              const archived = !v.isActive
              return (
                <tr
                  key={v.id}
                  className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${archived ? 'opacity-60' : ''}`}
                >
                  <td className="px-3 py-2 text-sm">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editValues.name}
                        onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                        className="w-full px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-sm text-white"
                      />
                    ) : (
                      <span className={`font-semibold ${archived ? 'text-zinc-500' : 'text-white'}`}>
                        {v.name}
                        {archived && <span className="ml-2 text-[10px] uppercase tracking-wider text-zinc-500">archived</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-400 font-mono">
                    {isEditing ? (
                      <input
                        type="url"
                        value={editValues.website}
                        onChange={(e) => setEditValues({ ...editValues, website: e.target.value })}
                        placeholder="https://…"
                        className="w-full px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-xs text-white font-mono"
                      />
                    ) : v.website ? (
                      <a href={v.website} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 truncate inline-block max-w-xs align-middle">
                        {v.website}
                      </a>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-400">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editValues.notes}
                        onChange={(e) => setEditValues({ ...editValues, notes: e.target.value })}
                        placeholder="phone / email / rep / acct #"
                        className="w-full px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-xs text-white"
                      />
                    ) : (
                      <span className="truncate inline-block max-w-xs align-middle" title={[v.contactName, v.email, v.phone, v.notes].filter(Boolean).join(' · ')}>
                        {[v.contactName, v.email, v.phone, v.notes].filter(Boolean).join(' · ') || <span className="text-zinc-600">—</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-center text-zinc-300 font-mono">{v._count?.subRentals ?? 0}</td>
                  <td className="px-3 py-2 text-xs text-center text-zinc-300 font-mono">{v._count?.inventoryItems ?? 0}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {isEditing ? (
                      <>
                        <button onClick={() => saveEdit(v.id)} className="text-emerald-400 hover:text-emerald-300 text-xs mr-2">Save</button>
                        <button onClick={() => setEditingId(null)} className="text-zinc-500 hover:text-zinc-300 text-xs">Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(v)} className="text-zinc-500 hover:text-blue-400 text-xs mr-2">Edit</button>
                        <button
                          onClick={() => setArchived(v.id, !archived)}
                          className={`text-xs ${archived ? 'text-emerald-400 hover:text-emerald-300' : 'text-zinc-500 hover:text-red-400'}`}
                        >
                          {archived ? 'Restore' : 'Archive'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
