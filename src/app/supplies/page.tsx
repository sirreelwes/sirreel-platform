'use client'

/**
 * Public supply catalog browse page. Phase 2 of the supply-ordering
 * brief — read-only browse + search; cart/submit lands in Phase 3.
 *
 * Renders /api/public/catalog (no auth) grouped by InventoryCategory
 * (sortOrder ascending). A search box hits ?q= which the API runs
 * against description + code + curated aliases[] (so "genny"
 * surfaces the generators, "pop up" surfaces the canopies, etc.).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface CatalogItem {
  id: string
  name: string
  price: number
  type: 'EQUIPMENT' | 'EXPENDABLE' | string
  category: string
}

interface CatalogCategory {
  id: string
  slug: string
  name: string
  sortOrder: number
  items: CatalogItem[]
}

interface CatalogResponse {
  categories: CatalogCategory[]
  totals: { categories: number; items: number }
}

function fmtPrice(n: number, type: string): string {
  const unit = type === 'EXPENDABLE' ? 'ea' : 'day'
  const money = n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
  return `${money} / ${unit}`
}

export default function SuppliesPage() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [data, setData] = useState<CatalogResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Debounce — 200ms after the last keystroke, fire the search.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 200)
    return () => clearTimeout(t)
  }, [query])

  const fetchCatalog = useCallback(async (q: string) => {
    setLoading(true)
    setError(null)
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const url = q ? `/api/public/catalog?q=${encodeURIComponent(q)}` : '/api/public/catalog'
      const res = await fetch(url, { signal: ac.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as CatalogResponse
      setData(json)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchCatalog(debouncedQuery)
  }, [debouncedQuery, fetchCatalog])

  const countLabel = useMemo(() => {
    if (loading) return 'Loading…'
    if (error) return error
    if (!data) return ''
    const { items, categories } = data.totals
    if (debouncedQuery && items === 0) return `No items match "${debouncedQuery}".`
    if (debouncedQuery) return `${items} item${items === 1 ? '' : 's'} across ${categories} categor${categories === 1 ? 'y' : 'ies'}`
    return `${items} items across ${categories} categories`
  }, [data, loading, error, debouncedQuery])

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="sticky top-0 z-10 bg-white border-b border-zinc-200">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h1 className="text-xl font-semibold text-zinc-900">SirReel Supplies</h1>
            <span className="text-xs text-zinc-500">{countLabel}</span>
          </div>
          <div className="mt-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Search supplies — try "genny", "pop up", or "stinger"…'
              autoFocus
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-900 text-sm px-3 py-2 mb-4">
            Couldn't load the catalog: {error}
          </div>
        )}

        {data && data.categories.length === 0 && !loading && !error && (
          <div className="text-center text-sm text-zinc-500 py-12">
            {debouncedQuery
              ? `No items match "${debouncedQuery}". Try a different search term.`
              : 'No items in the catalog yet.'}
          </div>
        )}

        <div className="space-y-6">
          {data?.categories.map((cat) => (
            <section
              key={cat.id}
              className="bg-white border border-zinc-200 rounded-xl overflow-hidden"
            >
              <header className="px-4 py-3 border-b border-zinc-100 flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold text-zinc-900">{cat.name}</h2>
                <span className="text-[11px] text-zinc-500">
                  {cat.items.length} item{cat.items.length === 1 ? '' : 's'}
                </span>
              </header>
              <ul className="divide-y divide-zinc-100">
                {cat.items.map((it) => (
                  <li key={it.id} className="px-4 py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm text-zinc-900 truncate">{it.name}</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider mr-2 ${
                            it.type === 'EXPENDABLE'
                              ? 'bg-orange-100 text-orange-800'
                              : 'bg-sky-100 text-sky-800'
                          }`}
                        >
                          {it.type === 'EXPENDABLE' ? 'each' : 'rental'}
                        </span>
                        {cat.name}
                      </div>
                    </div>
                    <div className="text-sm font-mono text-zinc-900 whitespace-nowrap">
                      {fmtPrice(it.price, it.type)}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="mt-10 mb-4 text-center text-[11px] text-zinc-400">
          Ordering goes live shortly. For now, send the items you need to your SirReel agent and they'll set up the order.
        </footer>
      </main>
    </div>
  )
}
