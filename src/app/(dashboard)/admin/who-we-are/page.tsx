'use client'

import { useEffect, useRef, useState } from 'react'

type Member = { id: string; name: string; title: string; published: boolean; sortOrder: number; hasPhoto: boolean }

export default function WhoWeAreAdminPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const [ver, setVer] = useState(0) // cache-bust photos after upload
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/who-we-are')
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
      const d = await res.json()
      setMembers(d.members || [])
      setEnabled(!!d.enabled)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  async function post(body: unknown) {
    const res = await fetch('/api/admin/who-we-are', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
    return res.json()
  }
  async function patch(id: string, body: unknown) {
    const res = await fetch(`/api/admin/who-we-are/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
  }

  async function toggleEnabled() {
    try {
      await post({ action: 'set-enabled', enabled: !enabled })
      setEnabled((v) => !v)
    } catch (e) {
      alert('Failed: ' + (e instanceof Error ? e.message : 'error'))
    }
  }

  async function addMember() {
    if (!newName.trim()) return
    setAdding(true)
    try {
      await post({ action: 'create', name: newName, title: newTitle })
      setNewName('')
      setNewTitle('')
      await load()
    } catch (e) {
      alert('Failed: ' + (e instanceof Error ? e.message : 'error'))
    } finally {
      setAdding(false)
    }
  }

  async function saveField(id: string, field: 'name' | 'title', value: string) {
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, [field]: value } : m)))
    try {
      await patch(id, { [field]: value })
    } catch {
      /* reload on next load; keep optimistic */
    }
  }

  async function togglePublished(m: Member) {
    try {
      await patch(m.id, { published: !m.published })
      setMembers((ms) => ms.map((x) => (x.id === m.id ? { ...x, published: !x.published } : x)))
    } catch (e) {
      alert('Failed: ' + (e instanceof Error ? e.message : 'error'))
    }
  }

  async function move(idx: number, dir: -1 | 1) {
    const a = members[idx]
    const b = members[idx + dir]
    if (!a || !b) return
    try {
      await Promise.all([patch(a.id, { sortOrder: b.sortOrder }), patch(b.id, { sortOrder: a.sortOrder })])
      await load()
    } catch (e) {
      alert('Failed: ' + (e instanceof Error ? e.message : 'error'))
    }
  }

  async function remove(m: Member) {
    if (!confirm(`Remove ${m.name} from the team section?`)) return
    try {
      const res = await fetch(`/api/admin/who-we-are/${m.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
      setMembers((ms) => ms.filter((x) => x.id !== m.id))
    } catch (e) {
      alert('Failed: ' + (e instanceof Error ? e.message : 'error'))
    }
  }

  async function uploadPhoto(id: string, file: File) {
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch(`/api/admin/who-we-are/${id}/photo`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
      setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, hasPhoto: true } : m)))
      setVer((v) => v + 1)
    } catch (e) {
      alert('Upload failed: ' + (e instanceof Error ? e.message : 'error'))
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto text-white">
      <h1 className="text-2xl font-semibold">Who We Are</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Manage the team roster shown in the &ldquo;Who we are&rdquo; section on the public contact page.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      {/* Master toggle */}
      <section className="mt-6 flex items-center justify-between rounded-xl border border-zinc-700 bg-zinc-900 p-5">
        <div>
          <div className="text-sm font-semibold">Show on the contact page</div>
          <div className="text-xs text-zinc-500 mt-0.5">
            When on, published members appear in the &ldquo;Who we are&rdquo; section. Off = hidden entirely.
          </div>
        </div>
        <button
          onClick={toggleEnabled}
          role="switch"
          aria-checked={enabled}
          className={`relative h-7 w-12 rounded-full transition-colors ${enabled ? 'bg-amber-600' : 'bg-zinc-700'}`}
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${enabled ? 'left-6' : 'left-1'}`} />
        </button>
      </section>

      {/* Add member */}
      <section className="mt-4 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
        <div className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-3">Add a team member</div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Name</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Jane Doe"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none" />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Job title</label>
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Studio Manager"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none" />
          </div>
          <button onClick={addMember} disabled={adding || !newName.trim()}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-40">
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
      </section>

      {/* Roster */}
      <section className="mt-4 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
        <div className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-3">
          Roster {members.length > 0 && <span className="text-zinc-600">· {members.length}</span>}
        </div>
        {loading ? (
          <div className="text-sm text-zinc-400">Loading…</div>
        ) : members.length === 0 ? (
          <div className="text-sm text-zinc-500">No team members yet — add one above.</div>
        ) : (
          <div className="space-y-2">
            {members.map((m, i) => (
              <div key={m.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-800/40 p-3">
                {/* photo */}
                <button
                  onClick={() => fileInputs.current[m.id]?.click()}
                  className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border border-zinc-700 bg-zinc-800"
                  title="Upload photo"
                >
                  {m.hasPhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/public/catalog-image/team-photo/${m.id}?v=${ver}`} alt={m.name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500">Add photo</span>
                  )}
                </button>
                <input
                  ref={(el) => {
                    fileInputs.current[m.id] = el
                  }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) uploadPhoto(m.id, f)
                    e.target.value = ''
                  }}
                />
                {/* name + title */}
                <div className="flex-1 grid sm:grid-cols-2 gap-2">
                  <input defaultValue={m.name} onBlur={(e) => saveField(m.id, 'name', e.target.value)}
                    className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-white focus:border-amber-500 focus:outline-none" />
                  <input defaultValue={m.title} onBlur={(e) => saveField(m.id, 'title', e.target.value)} placeholder="Job title"
                    className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-300 focus:border-amber-500 focus:outline-none" />
                </div>
                {/* controls */}
                <div className="flex items-center gap-1.5">
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="h-7 w-7 rounded border border-zinc-700 text-zinc-400 hover:text-white disabled:opacity-30" title="Move up">↑</button>
                  <button onClick={() => move(i, 1)} disabled={i === members.length - 1} className="h-7 w-7 rounded border border-zinc-700 text-zinc-400 hover:text-white disabled:opacity-30" title="Move down">↓</button>
                  <button onClick={() => togglePublished(m)}
                    className={`rounded px-2.5 py-1 text-[11px] font-semibold ${m.published ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-800' : 'bg-zinc-800 text-zinc-500 border border-zinc-700'}`}
                    title="Toggle published">
                    {m.published ? 'Published' : 'Hidden'}
                  </button>
                  <button onClick={() => remove(m)} className="h-7 w-7 rounded border border-zinc-700 text-red-400 hover:border-red-500" title="Remove">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
