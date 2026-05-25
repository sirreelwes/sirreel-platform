'use client'

/**
 * Public supply catalog browse + cart + submit. Phase 2 (browse +
 * search) + Phase 3 (cart, submit-as-Inquiry).
 *
 * - Reads /api/public/catalog (search via ?q=, alias-aware).
 * - Cart state is Map<itemId, CartLine>, persisted in sessionStorage
 *   so an accidental refresh doesn't nuke a half-built order.
 * - Sticky bottom bar surfaces cart totals + "Review & submit".
 * - Review modal collects contact + production + dates + notes;
 *   POST /api/public/supplies/submit creates an Inquiry(WEB_FORM).
 * - On success, the page renders a confirmation card with a short
 *   reference code; cart is cleared.
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
interface CartLine {
  itemId: string
  name: string
  price: number
  type: 'EQUIPMENT' | 'EXPENDABLE' | string
  category: string
  quantity: number
}

const CART_KEY = 'sr_supply_cart_v1'

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
}
function fmtPrice(n: number, type: string): string {
  const unit = type === 'EXPENDABLE' ? 'ea' : 'day'
  return `${fmtMoney(n)} / ${unit}`
}
function daysBetween(start: string, end: string): number {
  if (!start || !end) return 1
  const s = new Date(`${start}T00:00:00Z`).getTime()
  const e = new Date(`${end}T00:00:00Z`).getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 1
  return Math.max(1, Math.round((e - s) / 86_400_000) + 1)
}

export default function SuppliesPage() {
  // ── Catalog data ──────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [data, setData] = useState<CatalogResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

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

  // ── Cart state (sessionStorage-backed) ───────────────────────
  const [cart, setCart] = useState<Map<string, CartLine>>(() => new Map())
  const [cartHydrated, setCartHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CART_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as CartLine[]
        const next = new Map<string, CartLine>()
        for (const l of parsed) if (l?.itemId && l.quantity > 0) next.set(l.itemId, l)
        setCart(next)
      }
    } catch {}
    setCartHydrated(true)
  }, [])

  useEffect(() => {
    if (!cartHydrated) return
    try {
      sessionStorage.setItem(CART_KEY, JSON.stringify([...cart.values()]))
    } catch {}
  }, [cart, cartHydrated])

  const addToCart = useCallback((it: CatalogItem) => {
    setCart((prev) => {
      const next = new Map(prev)
      const existing = next.get(it.id)
      if (existing) {
        next.set(it.id, { ...existing, quantity: existing.quantity + 1 })
      } else {
        next.set(it.id, {
          itemId: it.id,
          name: it.name,
          price: it.price,
          type: it.type,
          category: it.category,
          quantity: 1,
        })
      }
      return next
    })
  }, [])

  const setQty = useCallback((itemId: string, qty: number) => {
    setCart((prev) => {
      const next = new Map(prev)
      const line = next.get(itemId)
      if (!line) return prev
      if (qty <= 0) next.delete(itemId)
      else next.set(itemId, { ...line, quantity: Math.min(1000, Math.max(1, Math.floor(qty))) })
      return next
    })
  }, [])

  const clearCart = useCallback(() => {
    setCart(new Map())
    try {
      sessionStorage.removeItem(CART_KEY)
    } catch {}
  }, [])

  // ── Review modal + submit ────────────────────────────────────
  const [reviewing, setReviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<{ reference: string } | null>(null)

  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [productionName, setProductionName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [notes, setNotes] = useState('')

  const cartLines = useMemo(() => [...cart.values()], [cart])
  const cartUnits = useMemo(() => cartLines.reduce((s, l) => s + l.quantity, 0), [cartLines])
  const hasEquipment = useMemo(() => cartLines.some((l) => l.type === 'EQUIPMENT'), [cartLines])

  const rentalDays = useMemo(() => {
    if (!hasEquipment) return 1
    return daysBetween(startDate, endDate)
  }, [startDate, endDate, hasEquipment])

  const cartTotal = useMemo(() => {
    return cartLines.reduce((s, l) => {
      const days = l.type === 'EQUIPMENT' ? rentalDays : 1
      return s + l.price * l.quantity * days
    }, 0)
  }, [cartLines, rentalDays])

  const canSubmit =
    cartLines.length > 0 &&
    contactName.trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim()) &&
    (!hasEquipment || (startDate && endDate && endDate >= startDate))

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch('/api/public/supplies/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact: { name: contactName.trim(), email: contactEmail.trim(), phone: contactPhone.trim() || null },
          production: { companyName: companyName.trim() || null, productionName: productionName.trim() || null },
          dates: hasEquipment ? { start: startDate, end: endDate } : null,
          cart: cartLines.map((l) => ({
            itemId: l.itemId,
            quantity: l.quantity,
            days: l.type === 'EQUIPMENT' ? rentalDays : null,
          })),
          notes: notes.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setSubmitError(json.error || `HTTP ${res.status}`)
        return
      }
      setConfirmation({ reference: json.reference })
      clearCart()
      setReviewing(false)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────
  const countLabel = useMemo(() => {
    if (loading) return 'Loading…'
    if (error) return error
    if (!data) return ''
    const { items, categories } = data.totals
    if (debouncedQuery && items === 0) return `No items match "${debouncedQuery}".`
    if (debouncedQuery) return `${items} item${items === 1 ? '' : 's'} across ${categories} categor${categories === 1 ? 'y' : 'ies'}`
    return `${items} items across ${categories} categories`
  }, [data, loading, error, debouncedQuery])

  if (confirmation) {
    return (
      <div className="min-h-screen bg-zinc-50 px-4 py-16">
        <div className="max-w-md mx-auto bg-white border border-zinc-200 rounded-2xl p-8 shadow-sm text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-2xl font-bold">
            ✓
          </div>
          <h1 className="text-xl font-semibold text-zinc-900 mt-4">Request received</h1>
          <p className="text-sm text-zinc-600 mt-2">
            Your SirReel agent will follow up shortly with a quote and confirmation.
          </p>
          <div className="mt-5 text-xs text-zinc-500">Reference</div>
          <div className="text-base font-mono font-semibold text-zinc-900 mt-1">{confirmation.reference}</div>
          <button
            onClick={() => setConfirmation(null)}
            className="mt-6 text-sm text-amber-700 hover:text-amber-600"
          >
            Browse supplies again →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-50 pb-32">
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
            <section key={cat.id} className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
              <header className="px-4 py-3 border-b border-zinc-100 flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold text-zinc-900">{cat.name}</h2>
                <span className="text-[11px] text-zinc-500">
                  {cat.items.length} item{cat.items.length === 1 ? '' : 's'}
                </span>
              </header>
              <ul className="divide-y divide-zinc-100">
                {cat.items.map((it) => {
                  const inCart = cart.get(it.id)
                  return (
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
                          {fmtPrice(it.price, it.type)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {inCart ? (
                          <div className="inline-flex items-center gap-1 border border-zinc-300 rounded-lg overflow-hidden">
                            <button
                              onClick={() => setQty(it.id, inCart.quantity - 1)}
                              className="px-2.5 py-1 text-zinc-700 hover:bg-zinc-100"
                              aria-label="Decrease quantity"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={1}
                              max={1000}
                              value={inCart.quantity}
                              onChange={(e) => setQty(it.id, parseInt(e.target.value, 10) || 1)}
                              className="w-12 text-center text-sm border-x border-zinc-200 outline-none py-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button
                              onClick={() => setQty(it.id, inCart.quantity + 1)}
                              className="px-2.5 py-1 text-zinc-700 hover:bg-zinc-100"
                              aria-label="Increase quantity"
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => addToCart(it)}
                            className="px-3 py-1 text-xs font-semibold rounded-lg border border-zinc-300 text-zinc-700 hover:border-amber-500 hover:text-amber-700"
                          >
                            Add
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </main>

      {/* Sticky cart bar */}
      {cartLines.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-20 bg-white border-t border-zinc-200 shadow-lg">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-zinc-700">
              <span className="font-semibold text-zinc-900">{cartUnits}</span> unit{cartUnits === 1 ? '' : 's'}
              {hasEquipment && (
                <span className="text-zinc-500 ml-2 text-xs">(rental dates set at review)</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={clearCart}
                className="text-xs text-zinc-500 hover:text-zinc-700"
              >
                Clear
              </button>
              <button
                onClick={() => setReviewing(true)}
                className="bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold px-4 py-1.5 rounded-lg"
              >
                Review &amp; submit →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review modal */}
      {reviewing && (
        <div className="fixed inset-0 z-30 bg-black/40 px-4 py-8 overflow-y-auto" onClick={() => !submitting && setReviewing(false)}>
          <div
            className="max-w-2xl mx-auto bg-white rounded-2xl shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-6 py-4 border-b border-zinc-200 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-zinc-900">Review &amp; submit</h2>
              <button
                onClick={() => !submitting && setReviewing(false)}
                className="text-zinc-400 hover:text-zinc-700 text-xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </header>

            <div className="px-6 py-4 space-y-5">
              {/* Cart summary */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">Your request</div>
                <ul className="divide-y divide-zinc-100 border border-zinc-200 rounded-lg overflow-hidden">
                  {cartLines.map((l) => {
                    const days = l.type === 'EQUIPMENT' ? rentalDays : 1
                    const lineTotal = l.price * l.quantity * days
                    return (
                      <li key={l.itemId} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <div className="text-zinc-900 truncate">{l.name}</div>
                          <div className="text-[11px] text-zinc-500">
                            {l.quantity}
                            {l.type === 'EQUIPMENT' && ` × ${days}d`}
                            {' @ '}
                            {fmtMoney(l.price)}
                            {l.type === 'EQUIPMENT' ? '/day' : '/ea'}
                          </div>
                        </div>
                        <div className="font-mono text-zinc-900 text-sm whitespace-nowrap">{fmtMoney(lineTotal)}</div>
                      </li>
                    )
                  })}
                </ul>
                <div className="flex items-center justify-between mt-3 text-sm">
                  <span className="text-zinc-500">
                    Estimated total{hasEquipment && startDate && endDate ? ` (${rentalDays}d rental)` : ''}
                  </span>
                  <span className="font-mono font-semibold text-zinc-900">{fmtMoney(cartTotal)}</span>
                </div>
              </div>

              {/* Contact */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">
                    Your name *
                  </label>
                  <input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">
                    Email *
                  </label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    autoComplete="tel"
                    className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">
                    Production company
                  </label>
                  <input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">
                    Production name
                  </label>
                  <input
                    value={productionName}
                    onChange={(e) => setProductionName(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* Dates — only required when cart has EQUIPMENT */}
              {hasEquipment && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
                    Rental dates *
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-zinc-500 mb-1">Pickup</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        required
                        className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-500 mb-1">Return</label>
                      <input
                        type="date"
                        value={endDate}
                        min={startDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        required
                        className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  maxLength={5000}
                  placeholder="Delivery location, special requirements, etc."
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:border-amber-500 resize-y"
                />
              </div>

              {submitError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-900 text-sm px-3 py-2">
                  {submitError}
                </div>
              )}
            </div>

            <footer className="px-6 py-3 border-t border-zinc-200 flex items-center justify-end gap-2">
              <button
                onClick={() => !submitting && setReviewing(false)}
                disabled={submitting}
                className="text-sm text-zinc-600 hover:text-zinc-900 px-3 py-1.5"
              >
                Back
              </button>
              <button
                onClick={submit}
                disabled={!canSubmit || submitting}
                className="bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-300 text-white text-sm font-semibold px-4 py-1.5 rounded-lg"
              >
                {submitting ? 'Submitting…' : 'Submit request'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}
