'use client'

/**
 * Inventory values + photos wizard  (/inventory/wizard)
 *
 * A guided, one-item-at-a-time pass over the ENTIRE active inventory to
 * fill in the two fields that are almost universally blank after the RW
 * import: `replacementCost` and a per-item photo. Built because doing
 * 700+ rows through the inline table editor (or the per-row detail
 * modal) is impractical.
 *
 * Reuse (no new backend):
 *   - GET  /api/inventory/items?limit=1000   — pull the whole list once
 *   - PUT  /api/inventory/items/[id]         — persist replacementCost
 *   - POST /api/inventory/items/[id]/image   — photo upload
 *   - resizeImage / uploadInventoryItemImage — shared client util
 *     (also used by InventoryDetailModal)
 *
 * Flow:
 *   - Pick a "view" (needs both / needs value / needs photo / all) and
 *     optionally a category to focus a batch.
 *   - The wizard walks the filtered queue. For each item: enter the
 *     replacement value and/or drop a photo, then "Save & next".
 *   - "Carry $X forward" copies the last value entered — fast when a
 *     run of similar items shares a price.
 *   - Coverage counters update live; the queue shrinks as items get
 *     completed ("needs …" views drop finished rows automatically).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  uploadInventoryItemImage,
  ACCEPT_IMAGE,
  MAX_LONG_EDGE,
  MAX_IMAGE_BYTES,
} from '@/lib/inventory/resizeImage'

type ViewMode = 'either' | 'value' | 'photo' | 'all'

interface WizardItem {
  id: string
  code: string
  description: string | null
  categoryName: string
  replacementCost: number | null
  imageUrl: string | null
  qtyOwned: number
}

interface ApiItem {
  id: string
  code: string
  description: string | null
  replacementCost: string | null
  imageUrl: string | null
  qtyOwned: number
  category: { id: string; name: string } | null
}

interface CategoryOption {
  id: string
  name: string
  _count: { items: number }
}

const VIEW_LABELS: Record<ViewMode, string> = {
  either: 'Needs value or photo',
  value: 'Needs value',
  photo: 'Needs photo',
  all: 'All items',
}

const hasValue = (i: WizardItem) => i.replacementCost != null && i.replacementCost > 0
const hasPhoto = (i: WizardItem) => !!i.imageUrl

function buildQueue(items: WizardItem[], mode: ViewMode, catId: string): WizardItem[] {
  return items.filter((i) => {
    if (catId && i.categoryName !== catId) return false
    switch (mode) {
      case 'value': return !hasValue(i)
      case 'photo': return !hasPhoto(i)
      case 'either': return !(hasValue(i) && hasPhoto(i))
      case 'all': return true
    }
  })
}

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export default function InventoryWizardPage() {
  const [items, setItems] = useState<WizardItem[]>([])
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [mode, setMode] = useState<ViewMode>('either')
  const [catFilter, setCatFilter] = useState('') // category NAME (queue groups by name)
  const [cursor, setCursor] = useState(0)

  const [costInput, setCostInput] = useState('')
  const [lastValue, setLastValue] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // ── Initial load: whole active inventory in one shot ──────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setLoadError('')
      try {
        const res = await fetch('/api/inventory/items?limit=1000')
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) { setLoadError(data.error || `Load failed (HTTP ${res.status})`); return }
        const mapped: WizardItem[] = (data.items as ApiItem[]).map((it) => ({
          id: it.id,
          code: it.code,
          description: it.description,
          categoryName: it.category?.name ?? 'Uncategorized',
          replacementCost: it.replacementCost != null ? Number(it.replacementCost) : null,
          imageUrl: it.imageUrl,
          qtyOwned: it.qtyOwned,
        }))
        setItems(mapped)
        setCategories(Array.isArray(data.categories) ? data.categories : [])
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Load failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const queue = useMemo(() => buildQueue(items, mode, catFilter), [items, mode, catFilter])
  const current = queue[cursor] ?? null

  // Reset to the front of the queue whenever the view changes.
  useEffect(() => { setCursor(0) }, [mode, catFilter])

  // Keep the cursor inside the (possibly shrunk) queue.
  useEffect(() => {
    if (cursor > queue.length - 1) setCursor(Math.max(0, queue.length - 1))
  }, [queue.length, cursor])

  // Reseed the cost field when the focused item changes.
  useEffect(() => {
    setCostInput(current?.replacementCost != null ? String(current.replacementCost) : '')
    setError('')
  }, [current?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Coverage (overall, ignores the active view filter) ────────────
  const coverage = useMemo(() => {
    const total = items.length
    const vals = items.filter(hasValue).length
    const photos = items.filter(hasPhoto).length
    const complete = items.filter((i) => hasValue(i) && hasPhoto(i)).length
    return { total, vals, photos, complete }
  }, [items])

  // ── Navigation ────────────────────────────────────────────────────
  const advance = useCallback(
    (nextItems: WizardItem[], curId: string) => {
      const q = buildQueue(nextItems, mode, catFilter)
      if (q.length === 0) { setCursor(0); return }
      const idx = q.findIndex((i) => i.id === curId)
      // Still in queue (e.g. 'all' view, or only one of the two fields
      // done) → step forward. Left the queue → the slot now holds the
      // next item, so keep the index (clamped).
      const next = idx >= 0 ? Math.min(idx + 1, q.length - 1) : Math.min(cursor, q.length - 1)
      setCursor(Math.max(0, next))
    },
    [mode, catFilter, cursor],
  )

  const goPrev = () => setCursor((c) => Math.max(0, c - 1))
  const goSkip = () => setCursor((c) => Math.min(queue.length - 1, c + 1))

  // ── Mutations ─────────────────────────────────────────────────────
  const saveValueAndNext = async () => {
    if (!current) return
    const trimmed = costInput.trim()
    const newVal = trimmed === '' ? null : Number(trimmed)
    if (trimmed !== '' && (!Number.isFinite(newVal) || (newVal as number) < 0)) {
      setError('Enter a valid non-negative amount.')
      return
    }
    setBusy(true); setError('')
    try {
      const cur = current
      const changed = (newVal ?? null) !== (cur.replacementCost ?? null)
      let nextItems = items
      if (changed) {
        const res = await fetch(`/api/inventory/items/${cur.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ replacementCost: trimmed === '' ? null : trimmed }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { setError(data.error || `Save failed (HTTP ${res.status})`); return }
        const saved = data.replacementCost != null ? Number(data.replacementCost) : null
        nextItems = items.map((i) => (i.id === cur.id ? { ...i, replacementCost: saved } : i))
        if (newVal != null) setLastValue(newVal)
      }
      setItems(nextItems)
      advance(nextItems, cur.id)
    } finally {
      setBusy(false)
    }
  }

  const onPickPhoto = async (file: File) => {
    if (!current) return
    setBusy(true); setError('')
    try {
      const newUrl = await uploadInventoryItemImage(current.id, file)
      setItems((prev) => prev.map((i) => (i.id === current.id ? { ...i, imageUrl: newUrl } : i)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  const removePhoto = async () => {
    if (!current?.imageUrl) return
    if (!confirm('Remove the photo from this item?')) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/inventory/items/${current.id}/image`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || `Remove failed (HTTP ${res.status})`)
        return
      }
      setItems((prev) => prev.map((i) => (i.id === current.id ? { ...i, imageUrl: null } : i)))
    } finally {
      setBusy(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────
  const pct = coverage.total > 0 ? Math.round((coverage.complete / coverage.total) * 100) : 0

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Values &amp; Photos Wizard</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Fill in replacement values and a photo for every item, one at a time.
          </p>
        </div>
        <Link href="/inventory" className="text-sm text-zinc-400 hover:text-white">
          ← Back to Inventory
        </Link>
      </div>

      {/* Coverage strip */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="text-zinc-300">Values <b className="text-white">{coverage.vals}</b><span className="text-zinc-500">/{coverage.total}</span></span>
          <span className="text-zinc-300">Photos <b className="text-white">{coverage.photos}</b><span className="text-zinc-500">/{coverage.total}</span></span>
          <span className="text-zinc-300">Complete <b className="text-emerald-400">{coverage.complete}</b><span className="text-zinc-500">/{coverage.total}</span></span>
          <span className="ml-auto text-zinc-400">{pct}% done</span>
        </div>
        <div className="mt-2 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* View controls */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex gap-1 bg-zinc-800 rounded-lg p-0.5">
          {(Object.keys(VIEW_LABELS) as ViewMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                mode === m ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {VIEW_LABELS[m]}
            </button>
          ))}
        </div>
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-white"
        >
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.name}>{c.name} ({c._count.items})</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-center text-zinc-500 py-16">Loading inventory…</div>
      ) : loadError ? (
        <div className="bg-red-900/30 border border-red-800/40 text-red-200 rounded-lg p-3 text-sm">{loadError}</div>
      ) : queue.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center">
          <div className="text-3xl mb-2">✓</div>
          <p className="text-white font-medium">Nothing left in this view.</p>
          <p className="text-sm text-zinc-400 mt-1">
            Every item under “{VIEW_LABELS[mode]}”{catFilter && ` in ${catFilter}`} is handled.
            Switch views above or head back to inventory.
          </p>
        </div>
      ) : current ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          {/* Position */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-zinc-500">
              Item {cursor + 1} of {queue.length} in this view
            </span>
            <div className="flex gap-1.5">
              {hasValue(current)
                ? <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300">$ set</span>
                : <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">no value</span>}
              {hasPhoto(current)
                ? <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300">photo</span>
                : <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">no photo</span>}
            </div>
          </div>

          {/* Identity */}
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              {current.code} · {current.categoryName} · qty {current.qtyOwned}
            </div>
            <h2 className="text-lg font-bold text-white mt-0.5 break-words">
              {current.description || current.code}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-5">
            {/* Photo */}
            <div className="space-y-2">
              <div className="w-full aspect-square bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden flex items-center justify-center text-zinc-600 text-xs">
                {current.imageUrl ? (
                  // Private blob — load via the gated proxy (raw URL 403s).
                  // Buster keyed on imageUrl so a replaced photo refetches.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/inventory/items/${current.id}/image?v=${encodeURIComponent(current.imageUrl)}`} alt={current.description || current.code} className="w-full h-full object-cover" />
                ) : (
                  <span>No photo</span>
                )}
              </div>
              <label className="block">
                <span className="sr-only">Choose photo</span>
                <input
                  type="file"
                  accept={ACCEPT_IMAGE}
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void onPickPhoto(f)
                    e.target.value = ''
                  }}
                  className="block w-full text-xs text-zinc-300 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-amber-600 hover:file:bg-amber-500 file:text-white file:cursor-pointer file:text-xs file:font-semibold"
                />
              </label>
              {current.imageUrl && (
                <button type="button" onClick={removePhoto} disabled={busy}
                  className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50">
                  Remove photo
                </button>
              )}
              <p className="text-[10px] text-zinc-500 leading-tight">
                jpg / png / webp (resized to {MAX_LONG_EDGE}px) or heic. Max {MAX_IMAGE_BYTES / 1024 / 1024} MB.
              </p>
            </div>

            {/* Value */}
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
                  Replacement value (per unit)
                </label>
                <div className="flex items-center gap-1">
                  <span className="text-zinc-500 text-lg">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    autoFocus
                    value={costInput}
                    onChange={(e) => setCostInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !busy) { e.preventDefault(); void saveValueAndNext() } }}
                    placeholder="0.00"
                    className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-lg text-white font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
                {lastValue != null && (
                  <button
                    type="button"
                    onClick={() => setCostInput(String(lastValue))}
                    disabled={busy}
                    className="mt-1.5 text-xs text-amber-500 hover:text-amber-400 disabled:opacity-50"
                  >
                    Carry {fmtMoney(lastValue)} forward
                  </button>
                )}
              </div>
              {current.replacementCost != null && (
                <p className="text-[11px] text-zinc-500">
                  Current on file: {fmtMoney(current.replacementCost)}
                  {current.qtyOwned > 0 && current.replacementCost > 0 && (
                    <> · total exposure {fmtMoney(current.replacementCost * current.qtyOwned)}</>
                  )}
                </p>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-4 bg-red-900/30 border border-red-800/40 text-red-200 rounded-lg p-2 text-[12px]">
              {error}
            </div>
          )}

          {/* Nav */}
          <div className="flex items-center justify-between gap-2 mt-5 pt-4 border-t border-zinc-800">
            <button
              type="button"
              onClick={goPrev}
              disabled={busy || cursor === 0}
              className="px-3 py-2 text-sm text-zinc-400 hover:text-white disabled:opacity-40"
            >
              ← Prev
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={goSkip}
                disabled={busy || cursor >= queue.length - 1}
                className="px-3 py-2 text-sm text-zinc-400 hover:text-white disabled:opacity-40"
              >
                Skip →
              </button>
              <button
                type="button"
                onClick={saveValueAndNext}
                disabled={busy}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-bold rounded-lg"
              >
                {busy ? 'Saving…' : 'Save value & next →'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
