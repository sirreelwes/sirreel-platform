'use client'

/**
 * /admin/public-catalog — the publish desk for the public order form.
 *
 * Built 2026-09-09 after the site-wide search shipped and turned up the
 * real problem: 1,474 active, priced, categorised items were hidden from
 * clients, including 74 C-Stands and 287 walkies. Nothing in HQ could flip
 * `publicVisible` — it was a DB-only column — so this is the surface for it.
 *
 * The screen leads with WHY something is hidden, not just that it is. An
 * item with no price stays invisible however many times you publish it, so
 * those rows show their blocker instead of a switch.
 *
 * Filtering is client-side over one fetch: the whole catalog arrives once
 * and every keystroke is instant. That's deliberate — a desk you have to
 * wait on is one people go back to spreadsheets to avoid.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, X, Check, EyeOff, Loader2, AlertTriangle } from 'lucide-react'

type Blocked = 'inactive' | 'no-category' | 'no-price' | 'not-public' | null

interface Item {
  id: string
  name: string
  code: string
  category: string | null
  daily: number
  includedFree: boolean
  qty: number
  aliases: string[]
  published: boolean
  unitTracked: boolean
  blockedBy: Blocked
  readyToPublish: boolean
}

interface Counts {
  active: number
  categorised: number
  priced: number
  published: number
  hidden: number
  hiddenInStock: number
  noPrice: number
  noCategory: number
}

type View = 'hidden' | 'published' | 'blocked' | 'all'

const VIEWS: { id: View; label: string }[] = [
  { id: 'hidden', label: 'Hidden' },
  { id: 'published', label: 'On the site' },
  { id: 'blocked', label: 'Needs a fix' },
  { id: 'all', label: 'Everything' },
]

const n = (v: number) => v.toLocaleString('en-US')

export default function PublicCatalogPage() {
  const [items, setItems] = useState<Item[]>([])
  const [counts, setCounts] = useState<Counts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [view, setView] = useState<View>('hidden')
  const [stockOnly, setStockOnly] = useState(true)
  const [cat, setCat] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<{ kind: 'good' | 'warn'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/public-catalog')
    if (res.status === 403) { setError('Admin access required.'); setLoading(false); return }
    if (res.status === 401) { setError('Sign in required.'); setLoading(false); return }
    if (!res.ok) { setError('Could not load the catalog.'); setLoading(false); return }
    const data = await res.json()
    setItems(data.items ?? [])
    setCounts(data.counts ?? null)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const inView = useMemo(() => {
    return items.filter((i) => {
      if (view === 'hidden') return i.blockedBy === 'not-public'
      if (view === 'published') return i.blockedBy === null
      if (view === 'blocked') return i.blockedBy === 'no-price' || i.blockedBy === 'no-category'
      return true
    })
  }, [items, view])

  const pool = useMemo(
    () => (stockOnly ? inView.filter((i) => i.qty > 0) : inView),
    [inView, stockOnly],
  )

  const catCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of pool) m.set(i.category ?? 'Uncategorised', (m.get(i.category ?? 'Uncategorised') ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [pool])

  const rows = useMemo(() => {
    const toks = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return pool
      .filter((i) => {
        if (cat && (i.category ?? 'Uncategorised') !== cat) return false
        if (!toks.length) return true
        const hay = `${i.name} ${i.code} ${i.category ?? ''} ${i.aliases.join(' ')}`.toLowerCase()
        return toks.every((t) => hay.includes(t))
      })
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))
  }, [pool, q, cat])

  const selectedRows = useMemo(() => rows.filter((r) => sel.has(r.id)), [rows, sel])

  const apply = async (ids: string[], publish: boolean, allowUnitTracked = false) => {
    if (!ids.length) return
    setSaving(true)
    setNote(null)
    const res = await fetch('/api/admin/public-catalog', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, publicVisible: publish, allowUnitTracked }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setNote({ kind: 'warn', text: d.error || 'That did not save.' })
      return
    }
    const d = await res.json()
    // Reflect the change locally so the row moves out of the Hidden view
    // immediately, then reconcile counts from the server.
    const changed = new Set<string>(ids)
    setItems((prev) =>
      prev.map((i) =>
        changed.has(i.id) && !(d.skipped ?? []).some((s: { id: string }) => s.id === i.id)
          ? { ...i, published: publish, blockedBy: publish ? null : ('not-public' as Blocked) }
          : i,
      ),
    )
    setSel(new Set())
    const skipped = (d.skipped ?? []) as { name: string; why: string }[]
    if (skipped.length) {
      const unit = skipped.filter((s) => s.why === 'already public on its own page')
      setNote({
        kind: 'warn',
        text:
          `${n(d.changed)} ${publish ? 'published' : 'hidden'}. ${n(skipped.length)} skipped — ` +
          skipped.slice(0, 3).map((s) => `${s.name} (${s.why})`).join(', ') +
          (skipped.length > 3 ? `, +${skipped.length - 3} more` : '') +
          (unit.length ? '. Tick “include vehicles & stages” to publish those anyway.' : ''),
      })
    } else {
      setNote({ kind: 'good', text: `${n(d.changed)} item${d.changed === 1 ? '' : 's'} ${publish ? 'published to the site' : 'hidden from the site'}.` })
    }
    load()
  }

  const [allowUnit, setAllowUnit] = useState(false)

  if (error) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="bg-chip-bad-bg text-chip-bad-fg border border-lt-hairline rounded-xl p-4 text-sm">{error}</div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold text-lt-fg">Public Catalog</h1>
        <p className="text-sm text-lt-fg2 mt-1 max-w-[70ch]">
          What clients can find on the order form and in site search. An item shows publicly
          only when it is active, categorised, priced, and published here.
        </p>
      </header>

      {/* The gate, as counts. Each step is a condition; the last is the one
          this screen controls. */}
      {counts && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Active items', value: counts.active, note: 'in the catalog' },
            { label: 'Categorised', value: counts.categorised, note: `${n(counts.noCategory)} without a category` },
            { label: 'Priced', value: counts.priced, note: `${n(counts.noPrice)} at $0` },
            { label: 'On the site', value: counts.published, note: `${n(counts.hidden)} hidden`, accent: true },
          ].map((c) => (
            <div key={c.label} className="bg-lt-card border border-lt-hairline rounded-xl px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-lt-fg3">{c.label}</div>
              <div className={`text-2xl font-semibold tabular-nums mt-1 ${c.accent ? 'text-amber-600' : 'text-lt-fg'}`}>
                {n(c.value)}
              </div>
              <div className="text-xs text-lt-fg2 mt-0.5">{c.note}</div>
            </div>
          ))}
        </div>
      )}

      {counts && counts.hiddenInStock > 0 && (
        <div className="flex items-start gap-2.5 bg-chip-warn-bg text-chip-warn-fg border border-lt-hairline rounded-xl px-4 py-3 mb-5 text-sm">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <b>{n(counts.hiddenInStock)} hidden items are physically in stock.</b> Those are the ones
            a client searches for and doesn&rsquo;t find — everything else has nothing on hand.
          </span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2.5 items-center mb-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-lt-fg3 pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, code or alias — c-stand, walkie, apple box…"
            className="w-full h-10 pl-10 pr-9 rounded-lg bg-lt-card border border-lt-hairline text-sm text-lt-fg placeholder:text-lt-fg3 outline-none focus:border-amber-600"
          />
          {q && (
            <button
              onClick={() => setQ('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-lt-fg3 hover:text-lt-fg"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="inline-flex rounded-lg border border-lt-hairline overflow-hidden bg-lt-card">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => { setView(v.id); setCat(null); setSel(new Set()) }}
              className={`px-3 h-10 text-[13px] font-medium transition-colors ${
                view === v.id ? 'bg-amber-600 text-white' : 'text-lt-fg2 hover:bg-lt-inner'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-lt-hairline bg-lt-card text-[13px] text-lt-fg2 cursor-pointer">
          <input type="checkbox" checked={stockOnly} onChange={(e) => { setStockOnly(e.target.checked); setSel(new Set()) }} className="accent-amber-600" />
          In stock only
        </label>
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          onClick={() => setCat(null)}
          className={`px-2.5 py-1 rounded-full text-[12.5px] font-medium border transition-colors ${
            cat === null ? 'bg-chip-neutral-bg text-chip-neutral-fg border-chip-muted-border' : 'bg-lt-card text-lt-fg2 border-lt-hairline hover:bg-lt-inner'
          }`}
        >
          All categories <span className="tabular-nums text-lt-fg3">{n(pool.length)}</span>
        </button>
        {catCounts.map(([name, count]) => (
          <button
            key={name}
            onClick={() => setCat(cat === name ? null : name)}
            className={`px-2.5 py-1 rounded-full text-[12.5px] font-medium border transition-colors ${
              cat === name ? 'bg-chip-neutral-bg text-chip-neutral-fg border-chip-muted-border' : 'bg-lt-card text-lt-fg2 border-lt-hairline hover:bg-lt-inner'
            }`}
          >
            {name} <span className="tabular-nums text-lt-fg3">{n(count)}</span>
          </button>
        ))}
      </div>

      {note && (
        <div
          className={`rounded-lg px-4 py-2.5 mb-3 text-[13px] border border-lt-hairline ${
            note.kind === 'good' ? 'bg-chip-good-bg text-chip-good-fg' : 'bg-chip-warn-bg text-chip-warn-fg'
          }`}
        >
          {note.text}
        </div>
      )}

      {/* Bulk bar */}
      <div className="flex flex-wrap items-center gap-2.5 bg-lt-card border border-lt-hairline rounded-t-xl px-4 py-2.5 border-b-0">
        <label className="inline-flex items-center gap-2 text-[13px] text-lt-fg2 cursor-pointer">
          <input
            type="checkbox"
            className="accent-amber-600"
            checked={rows.length > 0 && selectedRows.length === rows.length}
            ref={(el) => { if (el) el.indeterminate = selectedRows.length > 0 && selectedRows.length < rows.length }}
            onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
          />
          {selectedRows.length > 0 ? `${n(selectedRows.length)} selected` : `${n(rows.length)} shown`}
        </label>
        <div className="flex-1" />
        {selectedRows.some((r) => r.unitTracked) && (
          <label className="inline-flex items-center gap-2 text-[12.5px] text-chip-warn-fg bg-chip-warn-bg rounded-full px-2.5 py-1 cursor-pointer">
            <input type="checkbox" checked={allowUnit} onChange={(e) => setAllowUnit(e.target.checked)} className="accent-amber-600" />
            include vehicles &amp; stages
          </label>
        )}
        <button
          disabled={!selectedRows.length || saving}
          onClick={() => apply(selectedRows.map((r) => r.id), true, allowUnit)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-lt-inner disabled:text-lt-fg3 text-white text-[13px] font-medium transition-colors"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Publish
        </button>
        <button
          disabled={!selectedRows.length || saving}
          onClick={() => apply(selectedRows.map((r) => r.id), false)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-lt-hairline bg-lt-card hover:bg-lt-inner disabled:text-lt-fg3 text-lt-fg text-[13px] font-medium transition-colors"
        >
          <EyeOff size={14} />
          Hide
        </button>
      </div>

      {/* Table */}
      <div className="bg-lt-card border border-lt-hairline rounded-b-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-lt-hairline text-lt-fg3 text-left text-[11px] uppercase tracking-[0.1em]">
                <th className="pl-4 py-2.5 w-9" />
                <th className="px-3 py-2.5 font-semibold">Item</th>
                <th className="px-3 py-2.5 font-semibold">Category</th>
                <th className="px-3 py-2.5 font-semibold text-right">Day rate</th>
                <th className="px-3 py-2.5 font-semibold text-right">On hand</th>
                <th className="px-3 py-2.5 font-semibold text-right w-[132px]">On the site</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-lt-fg3">Loading the catalog…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-lt-fg3">Nothing matches that.</td></tr>
              )}
              {rows.map((r) => {
                const on = sel.has(r.id)
                const fixable = r.blockedBy === 'no-price' || r.blockedBy === 'no-category'
                return (
                  <tr key={r.id} className={`border-b border-lt-hairline last:border-b-0 ${on ? 'bg-lt-inner2' : 'hover:bg-lt-inner2'}`}>
                    <td className="pl-4 py-2.5 align-top">
                      <input
                        type="checkbox"
                        className="accent-amber-600 mt-0.5"
                        aria-label={`Select ${r.name}`}
                        checked={on}
                        onChange={(e) => {
                          const next = new Set(sel)
                          if (e.target.checked) next.add(r.id); else next.delete(r.id)
                          setSel(next)
                        }}
                      />
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="text-lt-fg font-medium flex items-center gap-2 flex-wrap">
                        {r.name}
                        {r.unitTracked && (
                          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] rounded-full px-1.5 py-0.5 bg-chip-warn-bg text-chip-warn-fg">
                            own page
                          </span>
                        )}
                        {r.includedFree && (
                          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] rounded-full px-1.5 py-0.5 bg-chip-neutral-bg text-chip-neutral-fg">
                            included
                          </span>
                        )}
                      </div>
                      {r.aliases.length > 0 && (
                        <div className="text-[11.5px] text-lt-fg3 mt-0.5">also called {r.aliases.slice(0, 4).join(', ')}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top text-lt-fg2 whitespace-nowrap">{r.category ?? '—'}</td>
                    <td className="px-3 py-2.5 align-top text-right tabular-nums text-lt-fg2 whitespace-nowrap">
                      {r.daily > 0 ? `$${r.daily}` : r.includedFree ? '—' : <span className="text-chip-bad-fg">$0</span>}
                    </td>
                    <td className="px-3 py-2.5 align-top text-right tabular-nums text-lt-fg2">{r.qty || '—'}</td>
                    <td className="px-3 py-2.5 align-top text-right">
                      {fixable ? (
                        // No switch: publishing this changes nothing until the
                        // blocker is fixed on the item itself.
                        <span className="text-[11.5px] text-chip-bad-fg">
                          {r.blockedBy === 'no-price' ? 'needs a price' : 'needs a category'}
                        </span>
                      ) : (
                        <button
                          disabled={saving}
                          onClick={() => apply([r.id], !r.published, r.unitTracked)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors ${
                            r.blockedBy === null
                              ? 'bg-chip-good-bg text-chip-good-fg border-chip-muted-border hover:bg-chip-neutral-bg'
                              : 'bg-lt-card text-lt-fg2 border-lt-hairline hover:bg-lt-inner'
                          }`}
                        >
                          {r.blockedBy === null ? <><Check size={12} /> Live</> : <><EyeOff size={12} /> Hidden</>}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-lt-fg3 mt-3">
        Publishing takes effect on the next page load — site search rebuilds its index once a minute.
      </p>
    </div>
  )
}
