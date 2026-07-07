'use client'

/**
 * Spaces admin — create / edit / publish / archive the Space catalog
 * (Standing Sets today; Stages + LED Wall reuse the same surface). Mirrors
 * the vehicle-catalog editor: private-Blob photo upload with set-primary /
 * reorder / delete, a publish toggle, and a client-visibility badge that
 * reflects the FULL public gate (active + published + has a photo).
 *
 * Admin-gated by the underlying /api/admin/spaces routes (requireAdmin).
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Photo = { id: string; sortOrder: number; isPrimary: boolean }
type SpaceType = 'STANDING_SET' | 'STAGE' | 'LED_WALL'
type Space = {
  id: string
  name: string
  type: SpaceType
  description: string | null
  sortOrder: number
  published: boolean
  active: boolean
  clientVisible: boolean
  photos: Photo[]
}

const TYPE_LABELS: Record<SpaceType, string> = {
  STANDING_SET: 'Standing Set',
  STAGE: 'Stage',
  LED_WALL: 'LED Wall',
}
const TYPES: SpaceType[] = ['STANDING_SET', 'STAGE', 'LED_WALL']

const inputCls =
  'w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500'
const labelCls = 'block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1'

export default function AdminSpacesPage() {
  const [spaces, setSpaces] = useState<Space[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [creating, setCreating] = useState(false)

  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<SpaceType>('STANDING_SET')
  const [newDesc, setNewDesc] = useState('')

  const [editName, setEditName] = useState('')
  const [editType, setEditType] = useState<SpaceType>('STANDING_SET')
  const [editDesc, setEditDesc] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/admin/spaces')
    if (res.status === 401) { setError('Sign in required.'); setLoading(false); return }
    if (res.status === 403) { setError('Forbidden — admin only.'); setLoading(false); return }
    const data = await res.json().catch(() => ({}))
    setSpaces(data.spaces || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return spaces.filter((s) => {
      if (!showArchived && !s.active) return false
      if (q && !s.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [spaces, search, showArchived])

  const startEdit = (s: Space) => {
    setEditingId(s.id)
    setEditName(s.name)
    setEditType(s.type)
    setEditDesc(s.description ?? '')
  }

  const createSpace = async () => {
    if (!newName.trim()) return
    setCreating(true)
    const res = await fetch('/api/admin/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, type: newType, description: newDesc }),
    })
    const d = await res.json().catch(() => ({}))
    setCreating(false)
    if (!res.ok) { alert(d.error || `Create failed (HTTP ${res.status})`); return }
    setNewName(''); setNewDesc(''); setNewType('STANDING_SET'); setShowAdd(false)
    load()
  }

  const saveEdit = async (id: string) => {
    const res = await fetch(`/api/admin/spaces/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName, type: editType, description: editDesc }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { alert(d.error || `Save failed (HTTP ${res.status})`); return }
    load()
  }

  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/spaces/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      alert(d.error || 'Update failed')
      return
    }
    load()
  }

  const setArchived = async (s: Space) => {
    const verb = s.active ? 'Archive' : 'Restore'
    if (!confirm(`${verb} "${s.name}"?`)) return
    await patch(s.id, { active: !s.active })
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">Spaces</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Standing Sets, Stages &amp; LED Wall — public gallery content. A space is client-visible only when <b>published</b> AND it has a photo.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="w-4 h-4 rounded border-zinc-600 bg-zinc-800" />
            Show archived
          </label>
          <button type="button" onClick={() => setShowAdd((v) => !v)} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-lg">
            {showAdd ? 'Close' : '+ Add space'}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-900/30 border border-red-800/40 text-red-200 rounded-lg p-3 text-sm mb-4">{error}</div>}

      {showAdd && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
          <h2 className="text-sm font-semibold text-white mb-3">Add space</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Name <span className="text-amber-500">*</span></label>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Hospital" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Type</label>
              <select value={newType} onChange={(e) => setNewType(e.target.value as SpaceType)} className={inputCls}>
                {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className={labelCls}>Description</label>
              <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={3} placeholder="Public description…" className={`${inputCls} resize-y`} />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => { setShowAdd(false); setNewName(''); setNewDesc('') }} className="px-4 py-2 text-zinc-400 hover:text-white text-sm">Cancel</button>
            <button type="button" onClick={createSpace} disabled={creating || !newName.trim()} className="px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-semibold rounded-lg">
              {creating ? 'Adding…' : 'Add space'}
            </button>
          </div>
        </div>
      )}

      <div className="mb-4">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name…" className="w-full md:max-w-sm px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500" />
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400 text-left text-xs uppercase tracking-wide">
              <th className="px-3 py-3 font-medium">Name</th>
              <th className="px-3 py-3 font-medium">Type</th>
              <th className="px-3 py-3 font-medium text-center">Photos</th>
              <th className="px-3 py-3 font-medium text-center">Status</th>
              <th className="px-3 py-3 font-medium text-right w-[220px]"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-zinc-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-zinc-500">{search.trim() ? 'No spaces match your search.' : 'No spaces yet — add one above.'}</td></tr>
            ) : filtered.map((s) => {
              const isEditing = editingId === s.id
              return (
                <Fragment key={s.id}>
                  <tr className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${!s.active ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-2">
                      <span className={`font-semibold ${!s.active ? 'text-zinc-500' : 'text-white'}`}>{s.name}</span>
                      {!s.active && <span className="ml-2 text-[10px] uppercase tracking-wider text-zinc-500">archived</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-300">{TYPE_LABELS[s.type]}</td>
                    <td className="px-3 py-2 text-xs text-center text-zinc-300 font-mono">{s.photos.length}</td>
                    <td className="px-3 py-2 text-center">
                      {s.clientVisible ? (
                        <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-400">Live</span>
                      ) : s.published ? (
                        <span className="text-[10px] uppercase tracking-wider font-bold text-amber-400" title="Published but no photo — still hidden publicly">Needs photo</span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wider font-bold text-zinc-500">Draft</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => (isEditing ? setEditingId(null) : startEdit(s))} className="text-zinc-500 hover:text-blue-400 text-xs mr-2">{isEditing ? 'Close' : 'Edit'}</button>
                      <button onClick={() => patch(s.id, { published: !s.published })} className={`text-xs mr-2 ${s.published ? 'text-amber-400 hover:text-amber-300' : 'text-emerald-400 hover:text-emerald-300'}`}>
                        {s.published ? 'Unpublish' : 'Publish'}
                      </button>
                      <button onClick={() => setArchived(s)} className={`text-xs ${!s.active ? 'text-emerald-400 hover:text-emerald-300' : 'text-zinc-500 hover:text-red-400'}`}>
                        {s.active ? 'Archive' : 'Restore'}
                      </button>
                    </td>
                  </tr>
                  {isEditing && (
                    <tr className="border-b border-zinc-800/50 bg-zinc-950/40">
                      <td colSpan={5} className="px-4 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div>
                            <label className={labelCls}>Name</label>
                            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className={inputCls} />
                          </div>
                          <div>
                            <label className={labelCls}>Type</label>
                            <select value={editType} onChange={(e) => setEditType(e.target.value as SpaceType)} className={inputCls}>
                              {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                            </select>
                          </div>
                          <div className="md:col-span-3">
                            <label className={labelCls}>Description</label>
                            <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={4} className={`${inputCls} resize-y`} />
                          </div>
                        </div>
                        <div className="mt-3 flex justify-end gap-2">
                          <button onClick={() => setEditingId(null)} className="px-4 py-2 text-zinc-400 hover:text-white text-sm">Cancel</button>
                          <button onClick={() => saveEdit(s.id)} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg">Save changes</button>
                        </div>
                        <PhotoManager space={s} onChanged={load} />
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

/** Photo upload + set-primary / reorder / delete for one space. */
function PhotoManager({ space, onChanged }: { space: Space; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const photos = [...space.photos].sort((a, b) => a.sortOrder - b.sortOrder)

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/admin/spaces/${space.id}/photos`, { method: 'POST', body: fd })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(d.error || `Upload failed for ${file.name}`)
        break
      }
    }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
    onChanged()
  }

  const photoPatch = async (photoId: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/spaces/${space.id}/photos/${photoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Update failed'); return }
    onChanged()
  }

  const swap = async (i: number, j: number) => {
    const a = photos[i], b = photos[j]
    if (!a || !b) return
    // Swap sortOrder values between neighbours (two PATCHes, then reload).
    await fetch(`/api/admin/spaces/${space.id}/photos/${a.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sortOrder: b.sortOrder }),
    })
    await fetch(`/api/admin/spaces/${space.id}/photos/${b.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sortOrder: a.sortOrder }),
    })
    onChanged()
  }

  const del = async (photoId: string) => {
    if (!confirm('Delete this photo?')) return
    const res = await fetch(`/api/admin/spaces/${space.id}/photos/${photoId}`, { method: 'DELETE' })
    if (!res.ok) { alert('Delete failed'); return }
    onChanged()
  }

  return (
    <div className="mt-4 pt-4 border-t border-zinc-800">
      <div className="flex items-center justify-between mb-3">
        <span className={labelCls}>Photos</span>
        <label className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-white cursor-pointer">
          {busy ? 'Uploading…' : '+ Upload photos'}
          <input ref={fileRef} type="file" accept="image/*" multiple hidden disabled={busy} onChange={(e) => upload(e.target.files)} />
        </label>
      </div>
      {photos.length === 0 ? (
        <p className="text-xs text-zinc-500">No photos yet — a space needs at least one photo to go live.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map((p, i) => (
            <div key={p.id} className={`relative rounded-lg overflow-hidden border ${p.isPrimary ? 'border-amber-500' : 'border-zinc-700'} bg-zinc-800`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/admin/spaces/${space.id}/photos/${p.id}`} alt="" className="w-full h-28 object-cover" />
              {p.isPrimary && <span className="absolute top-1 left-1 text-[9px] uppercase tracking-wider font-bold bg-amber-500 text-black px-1.5 py-0.5 rounded">Primary</span>}
              <div className="flex items-center justify-between gap-1 px-1.5 py-1 text-[11px]">
                <div className="flex gap-1">
                  <button onClick={() => swap(i, i - 1)} disabled={i === 0} className="text-zinc-400 hover:text-white disabled:opacity-30" title="Move left">←</button>
                  <button onClick={() => swap(i, i + 1)} disabled={i === photos.length - 1} className="text-zinc-400 hover:text-white disabled:opacity-30" title="Move right">→</button>
                </div>
                <div className="flex gap-2">
                  {!p.isPrimary && <button onClick={() => photoPatch(p.id, { isPrimary: true })} className="text-amber-400 hover:text-amber-300">Primary</button>}
                  <button onClick={() => del(p.id)} className="text-zinc-500 hover:text-red-400">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
