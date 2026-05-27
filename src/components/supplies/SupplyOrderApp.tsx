'use client'

/**
 * Shared Supply-Order composer. Built once, mounted by both the
 * public /order/supplies surface and (Phase 4 of the portal arc)
 * the signed-in /portal/supplies surface.
 *
 * Layout follows docs/sirreel-supply-order-mockup.html exactly:
 *   - dark sticky header (logo + Sign in + cart pill)
 *   - dark hero band with 3-step crumb
 *   - desktop two-column shell:
 *       left: sticky search + category pills + grouped catalog grid
 *       right: sticky dark cart (Estimated subtotal · Est. / day · CTA)
 *   - mobile: stacked, with a fixed bottom cart bar
 *   - three slide-in panels: Review (sheet) → Details (form) → Confirm
 *
 * Catalog data comes from /api/public/catalog (alias-aware ?q=). The
 * mockup hardcodes the catalog; this component fetches it live and
 * adapts the same shape per category for rendering.
 *
 * Cart state lives in useSupplyCart (sessionStorage-backed). The
 * submit endpoint is injectable via the `submitEndpoint` prop so the
 * portal mount can point at an auth-aware route later.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import Link from 'next/link'
import { useSupplyCart, type CartLine } from '@/hooks/useSupplyCart'

interface CatalogItem {
  id: string
  name: string
  price: number
  type: string
  category: string
}

// Default per-line dates when the agent hits Add. Reads from the
// form-level pickupDate/returnDate when those are filled (legacy
// step-2 inputs — to be removed in a later commit, kept as the
// per-add default for now); otherwise today / today+7. Always
// returns a YYYY-MM-DD string pair.
function defaultDatesForAdd(form: { pickupDate: string; returnDate: string }): {
  pickupDate: string
  returnDate: string
} {
  const today = new Date()
  const inAWeek = new Date(today.getTime() + 7 * 86_400_000)
  const ymd = (d: Date) => d.toISOString().slice(0, 10)
  const pickup = form.pickupDate || ymd(today)
  const returnD = form.returnDate || (form.pickupDate ? form.pickupDate : ymd(inAWeek))
  return { pickupDate: pickup, returnDate: returnD }
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

type DeliveryMethod = 'will-call' | 'sirreel-vehicle' | 'stage' | 'location'

interface DetailsForm {
  jobName: string
  companyName: string
  contactName: string
  role: string
  email: string
  phone: string
  pickupDate: string
  returnDate: string
  poNumber: string
  jobNumber: string
  deliveryMethod: DeliveryMethod | null
  deliveryAddress: string
  notes: string
  /** Honeypot — must stay empty. Hidden from real users. */
  website: string
}

const EMPTY_FORM: DetailsForm = {
  jobName: '',
  companyName: '',
  contactName: '',
  role: '',
  email: '',
  phone: '',
  pickupDate: '',
  returnDate: '',
  poNumber: '',
  jobNumber: '',
  deliveryMethod: null,
  deliveryAddress: '',
  notes: '',
  website: '',
}

const DELIVERY_OPTIONS: { id: DeliveryMethod; label: string; desc: string }[] = [
  { id: 'will-call', label: 'Will Call Pickup', desc: 'You collect from SirReel' },
  { id: 'sirreel-vehicle', label: 'Load in SirReel Vehicle', desc: 'Loaded into your rental' },
  { id: 'stage', label: 'SirReel Stage Delivery', desc: 'Delivered to a SirReel stage' },
  { id: 'location', label: 'Location Delivery', desc: 'Delivered to your location' },
]

function fmtMoney(n: number): string {
  if (n === 0) return 'FREE'
  return '$' + (Number.isInteger(n) ? n.toString() : n.toFixed(2))
}
function fmtTotal(n: number): string {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
function isPlausibleEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

interface SupplyOrderAppProps {
  submitEndpoint: string
  signInHref?: string | null
}

export function SupplyOrderApp({ submitEndpoint, signInHref = '/portal/auth/sign-in' }: SupplyOrderAppProps) {
  // ── Catalog data ──────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [activeCat, setActiveCat] = useState<string>('All')
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

  // ── Cart ──────────────────────────────────────────────────────
  const { lines, totalUnits, totalPerDay, hasEquipment, addToCart, setQty, resetCart } = useSupplyCart()
  // Index of current cart lines by source itemId — used by the
  // catalog tile to show the "in cart: N" badge + qty stepper.
  // Sums qty across all lines that reference the same itemId
  // (post-commit-2 the same item can appear on multiple lines with
  // different dates).
  const cartByItemId = useMemo(() => {
    const m = new Map<string, { totalQty: number; lines: CartLine[] }>()
    for (const l of lines) {
      const cur = m.get(l.itemId) ?? { totalQty: 0, lines: [] }
      cur.totalQty += l.qty
      cur.lines.push(l)
      m.set(l.itemId, cur)
    }
    return m
  }, [lines])

  // ── Panels (review / details / confirm) ───────────────────────
  const [panel, setPanel] = useState<'none' | 'sheet' | 'details' | 'confirm'>('none')
  const [form, setForm] = useState<DetailsForm>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<{
    reference: string
    contactName: string
    contactEmail: string
    jobName: string
    units: number
  } | null>(null)

  // Honeypot bots auto-fill the hidden `website` field; submit must
  // refuse silently when populated (no error surfaced — bot can't
  // tell its trick was caught).
  const canSubmit =
    lines.length > 0 &&
    form.contactName.trim().length > 0 &&
    form.companyName.trim().length > 0 &&
    isPlausibleEmail(form.email) &&
    !!form.pickupDate &&
    !!form.deliveryMethod &&
    (form.deliveryMethod !== 'location' || form.deliveryAddress.trim().length > 0)

  // Filtered catalog for current category pill (search overrides
  // the pill — when q is non-empty the API has already filtered).
  const visibleCategories = useMemo<CatalogCategory[]>(() => {
    if (!data) return []
    if (debouncedQuery) return data.categories
    if (activeCat === 'All') return data.categories
    return data.categories.filter((c) => c.name === activeCat)
  }, [data, debouncedQuery, activeCat])

  async function submitOrder(e?: FormEvent) {
    e?.preventDefault()
    if (!canSubmit || submitting) return
    if (form.website.trim().length > 0) {
      // Honeypot tripped — pretend success without writing anything.
      setConfirmation({
        reference: 'SR-REQ-0000',
        contactName: form.contactName,
        contactEmail: form.email,
        jobName: form.jobName || form.companyName || 'your production',
        units: totalUnits,
      })
      setPanel('confirm')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(submitEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact: {
            name: form.contactName.trim(),
            email: form.email.trim(),
            phone: form.phone.trim() || null,
            role: form.role.trim() || null,
          },
          production: {
            companyName: form.companyName.trim(),
            jobName: form.jobName.trim() || null,
            poNumber: form.poNumber.trim() || null,
            jobNumber: form.jobNumber.trim() || null,
          },
          dates: { start: form.pickupDate, end: form.returnDate || form.pickupDate },
          delivery: {
            method: form.deliveryMethod,
            address: form.deliveryMethod === 'location' ? form.deliveryAddress.trim() || null : null,
          },
          // Per-line dates carried in the cart shape now — inquiry-
          // level dates are derived server-side as min(pickup) /
          // max(return) across lines. Form-level pickup/return
          // inputs stay on the page for now (removed in a later
          // commit) but no longer feed the submission.
          cart: lines.map((l) => ({
            itemKind: l.itemKind,
            itemId: l.itemId,
            qty: l.qty,
            pickupDate: l.pickupDate,
            returnDate: l.returnDate,
          })),
          notes: form.notes.trim() || null,
          // Honeypot — server also enforces empty.
          website: form.website,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setSubmitError(json.error || `HTTP ${res.status}`)
        return
      }
      setConfirmation({
        reference: json.reference,
        contactName: form.contactName,
        contactEmail: form.email,
        jobName: form.jobName || form.companyName || 'your production',
        units: totalUnits,
      })
      resetCart()
      setPanel('confirm')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  function resetAll() {
    resetCart()
    setForm(EMPTY_FORM)
    setQuery('')
    setActiveCat('All')
    setConfirmation(null)
    setPanel('none')
  }

  return (
    <div className="min-h-screen bg-[#f4f1ea] text-[#0c0c0d]" style={{ fontFamily: '"Hanken Grotesk", Inter, system-ui, sans-serif' }}>
      {/* ── HEADER ────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-[#0c0c0d] text-white border-b border-black">
        <div className="max-w-[1480px] mx-auto px-5 h-[68px] flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="font-black text-2xl tracking-tight whitespace-nowrap" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Sir<span className="text-[#c39a3f]">Reel</span>
            </div>
            <div className="hidden sm:block w-px h-6 bg-zinc-700" />
            <div className="hidden sm:block text-[12px] font-semibold uppercase tracking-[0.14em] text-[#a8a294] whitespace-nowrap" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Studio Services
            </div>
          </div>
          <div className="flex items-center gap-3.5">
            {signInHref && (
              <Link
                href={signInHref}
                className="flex items-center gap-1.5 text-[#cfc9bd] hover:text-white text-[13px] font-semibold py-2 px-1"
                style={{ fontFamily: 'Archivo, sans-serif' }}
              >
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx={12} cy={7} r={4} />
                </svg>
                <span className="hidden sm:inline">Sign in</span>
              </Link>
            )}
            <button
              onClick={() => lines.length > 0 && setPanel('sheet')}
              className="flex items-center gap-2.5 bg-white text-[#0c0c0d] rounded-full px-4 py-2 text-[13px] font-bold hover:-translate-y-0.5 hover:shadow-lg transition-transform"
              style={{ fontFamily: 'Archivo, sans-serif' }}
            >
              <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx={9} cy={21} r={1} />
                <circle cx={20} cy={21} r={1} />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
              <span>Reservation</span>
              <span className="bg-[#c39a3f] text-[#0c0c0d] rounded-full min-w-[20px] h-[20px] inline-flex items-center justify-center text-[11px] px-1.5">
                {totalUnits}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="bg-[#0c0c0d] text-white relative overflow-hidden">
        <div className="max-w-[1480px] mx-auto px-5 py-12 sm:py-14 relative">
          <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f] mb-3.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
            Production Reservation
          </div>
          <h1 className="font-black tracking-tight leading-[0.92] text-[40px] sm:text-[56px] md:text-[68px] lg:text-[76px] max-w-[14ch]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            Reserve your production.
          </h1>
          <p className="mt-4 max-w-[52ch] text-[#cfc9bd] text-base leading-relaxed">
            Vehicles, basecamp basics, grip, power, safety, expendables — pick what your production needs and the dates you need it. We&apos;ll confirm availability and come back with a quote.
          </p>
          <div className="flex flex-wrap gap-7 mt-7">
            {[
              ['1', 'Pick vehicles & supplies'],
              ['2', 'Your details'],
              ['3', 'We confirm & quote'],
            ].map(([n, label]) => (
              <div key={n} className="flex items-center gap-2.5 text-[#e8e3d7] text-sm font-medium">
                <span className="font-extrabold text-[#0c0c0d] bg-[#c39a3f] w-[26px] h-[26px] rounded-full inline-flex items-center justify-center text-[13px]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                  {n}
                </span>
                {label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SHELL ────────────────────────────────────────────── */}
      <div className="max-w-[1480px] mx-auto px-5 relative">
        <div className="grid gap-8 pt-7 pb-[120px] lg:grid-cols-[1fr_374px] items-start">
          {/* LEFT: search + pills + catalog */}
          <main>
            <div className="sticky top-[68px] z-30 bg-[#f4f1ea] py-4 pb-3">
              <div className="relative">
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#8b857a" strokeWidth={2.2} strokeLinecap="round" className="absolute left-4 top-1/2 -translate-y-1/2">
                  <circle cx={11} cy={11} r={7} />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setActiveCat('All')
                  }}
                  placeholder="Search vehicles, supplies — generator, cargo van, c-stand…"
                  autoFocus
                  className="w-full border-[1.5px] border-[#cdc7b9] bg-white rounded-xl px-4 py-3.5 pl-[46px] text-base text-[#0c0c0d] outline-none focus:border-[#0c0c0d] focus:shadow-[0_0_0_4px_rgba(12,12,13,0.06)]"
                />
              </div>
              {data && (
                <div className="flex gap-2 overflow-x-auto pt-3.5 pb-1 scrollbar-none" style={{ scrollbarWidth: 'none' }}>
                  {['All', ...data.categories.map((c) => c.name)].map((c) => {
                    const isActive = c === activeCat && !debouncedQuery
                    return (
                      <button
                        key={c}
                        onClick={() => {
                          setActiveCat(c)
                          setQuery('')
                        }}
                        className={`flex-none border-[1.5px] rounded-full px-4 py-1.5 text-[12.5px] font-semibold tracking-tight whitespace-nowrap transition-all ${
                          isActive
                            ? 'bg-[#0c0c0d] text-white border-[#0c0c0d]'
                            : 'bg-transparent text-[#1a1a1c] border-[#cdc7b9] hover:border-[#0c0c0d]'
                        }`}
                        style={{ fontFamily: 'Archivo, sans-serif' }}
                      >
                        {c}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* catalog grid */}
            <div className="mt-3">
              {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-900 text-sm px-3 py-2 mb-4">
                  Couldn&apos;t load the catalog: {error}
                </div>
              )}
              {!loading && data && visibleCategories.length === 0 && (
                <div className="py-12 text-center text-[#8b857a]">
                  <b className="block text-lg text-[#1a1a1c] mb-1.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
                    Nothing matches &ldquo;{debouncedQuery}&rdquo;.
                  </b>
                  Try a broader term, or browse by category above.
                </div>
              )}
              {visibleCategories.map((cat) => (
                <section key={cat.id} className="mt-8 scroll-mt-[200px]">
                  <div className="flex items-baseline gap-3.5 mb-3.5">
                    <h2 className="font-extrabold tracking-tight text-[23px]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                      {cat.name}
                    </h2>
                    <span className="flex-1 h-[2px] bg-[#0c0c0d] opacity-10" />
                    <span className="font-semibold text-[12px] text-[#8b857a] tracking-wider" style={{ fontFamily: 'Archivo, sans-serif' }}>
                      {cat.items.length}
                    </span>
                  </div>
                  <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(234px, 1fr))' }}>
                    {cat.items.map((it) => {
                      // Across the cart, a single item can appear on
                      // multiple lines with different dates (post-
                      // commit-2). The catalog tile shows the summed
                      // qty for the "in cart" badge; the stepper +/-
                      // targets the first line (insertion order). UI
                      // for multi-line per-item edits lives in the
                      // cart panel rework (commit 5).
                      const slot = cartByItemId.get(it.id)
                      const firstLineId = slot?.lines[0]?.cartLineId ?? null
                      return (
                        <ItemCard
                          key={it.id}
                          item={it}
                          qty={slot?.totalQty ?? 0}
                          onAdd={() => {
                            const dates = defaultDatesForAdd(form)
                            addToCart({
                              itemKind: 'SUPPLY',
                              itemId: it.id,
                              name: it.name,
                              price: it.price,
                              type: it.type,
                              category: it.category,
                              pickupDate: dates.pickupDate,
                              returnDate: dates.returnDate,
                            })
                          }}
                          onSetQty={(q) => {
                            if (firstLineId) setQty(firstLineId, q)
                          }}
                        />
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          </main>

          {/* RIGHT: desktop cart */}
          <aside className="hidden lg:block">
            <CartSidebar
              lines={lines}
              totalUnits={totalUnits}
              totalPerDay={totalPerDay}
              onSetQty={setQty}
              onReview={() => setPanel('sheet')}
            />
          </aside>
        </div>
      </div>

      <div className="text-center text-[#8b857a] text-xs px-5 py-5 leading-relaxed">
        SirReel Studio Services · 8500 Lankershim Blvd, Sun Valley, CA 91352 · 888.477.7335 · info@sirreel.com
      </div>

      {/* Mobile cart bar */}
      {lines.length > 0 && (
        <div className="lg:hidden fixed left-0 right-0 bottom-0 z-40 bg-[#0c0c0d] text-white px-5 py-3.5 flex items-center justify-between shadow-[0_-10px_30px_rgba(0,0,0,0.25)]" style={{ paddingBottom: 'calc(13px + env(safe-area-inset-bottom))' }}>
          <div className="flex flex-col">
            <div className="font-extrabold text-lg text-[#c39a3f] leading-none" style={{ fontFamily: 'Archivo, sans-serif' }}>
              {fmtTotal(totalPerDay)}
            </div>
            <div className="text-xs text-[#a8a294] mt-1">
              {totalUnits} item{totalUnits === 1 ? '' : 's'} · est. / day
            </div>
          </div>
          <button
            onClick={() => setPanel('sheet')}
            className="bg-[#c39a3f] text-[#0c0c0d] rounded-lg px-5 py-3 text-sm font-extrabold"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            Review reservation →
          </button>
        </div>
      )}

      {/* Scrim + panels */}
      <Scrim show={panel !== 'none'} onClick={() => setPanel('none')} />

      <SlidePanel show={panel === 'sheet'}>
        <PanelHead title="Your Reservation" sub={lines.length ? `${totalUnits} item${totalUnits === 1 ? '' : 's'} · adjust below` : 'Review and adjust quantities'} onClose={() => setPanel('none')} />
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {lines.length === 0 ? (
            <div className="py-16 text-center text-[#8b857a]">
              <b className="block text-[#0c0c0d] font-extrabold mb-1" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Your reservation is empty
              </b>
              Add vehicles or supplies to continue.
            </div>
          ) : (
            lines.map((l) => <ReviewRow key={l.cartLineId} line={l} onSetQty={(q) => setQty(l.cartLineId, q)} />)
          )}
        </div>
        <div className="px-6 py-4 border-t border-[#e4dfd4] bg-white" style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
          <div className="flex justify-between items-baseline mb-3">
            <span className="font-bold text-sm uppercase tracking-wider" style={{ fontFamily: 'Archivo, sans-serif' }}>Est. / day</span>
            <span className="font-black text-2xl text-[#a37f2c] tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>{fmtTotal(totalPerDay)}</span>
          </div>
          <button
            onClick={() => setPanel('details')}
            disabled={lines.length === 0}
            className="w-full bg-[#0c0c0d] text-white rounded-xl py-4 text-sm font-extrabold tracking-wide disabled:bg-[#2a2a2c] disabled:text-[#5a5a5c] disabled:cursor-not-allowed transition-transform hover:-translate-y-0.5"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            Continue to details →
          </button>
        </div>
      </SlidePanel>

      <SlidePanel show={panel === 'details'}>
        <PanelHead title="Reservation Details" sub="So we can prep your quote" onClose={() => setPanel('sheet')} />
        <form onSubmit={submitOrder} className="flex-1 overflow-y-auto px-6 py-5">
          {/* Honeypot — visually hidden, kept tabindex-out-of-flow */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden' }}>
            <label>
              Website
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Field label="Job / Production Name" required value={form.jobName} onChange={(v) => setForm({ ...form, jobName: v })} placeholder="e.g. Juliet — Day 4" />
            <Field label="Company" required value={form.companyName} onChange={(v) => setForm({ ...form, companyName: v })} placeholder="Production company" />
            <Field label="Contact Name" required value={form.contactName} onChange={(v) => setForm({ ...form, contactName: v })} placeholder="Your name" />
            <Field label="Role / Position" value={form.role} onChange={(v) => setForm({ ...form, role: v })} placeholder="e.g. Production Coordinator" />
            <Field label="Email" required type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="you@company.com" />
            <Field label="Phone" type="tel" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="(818) 000-0000" />
            <Field label="Pickup / Delivery Date" required type="date" value={form.pickupDate} onChange={(v) => setForm({ ...form, pickupDate: v })} />
            <Field label="Return Date" type="date" value={form.returnDate} onChange={(v) => setForm({ ...form, returnDate: v })} />
            <Field label="PO #" value={form.poNumber} onChange={(v) => setForm({ ...form, poNumber: v })} placeholder="Optional" />
            <Field label="Job #" value={form.jobNumber} onChange={(v) => setForm({ ...form, jobNumber: v })} placeholder="Optional" />
          </div>

          <SegTitle>How do you want it?</SegTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {DELIVERY_OPTIONS.map((opt) => {
              const isSel = form.deliveryMethod === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setForm({ ...form, deliveryMethod: opt.id })}
                  className={`border-[1.5px] rounded-xl p-3.5 flex items-center gap-3 text-left transition-all ${
                    isSel
                      ? 'border-[#c39a3f] bg-[#fcf8ee] shadow-[0_0_0_1px_#c39a3f]'
                      : 'border-[#cdc7b9] bg-white hover:border-[#1a1a1c]'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full border-2 flex-none flex items-center justify-center ${isSel ? 'border-[#c39a3f]' : 'border-[#cdc7b9]'}`}>
                    {isSel && <span className="w-2.5 h-2.5 rounded-full bg-[#c39a3f]" />}
                  </span>
                  <span>
                    <span className="block font-semibold text-sm">{opt.label}</span>
                    <span className="block text-[11.5px] text-[#8b857a] mt-px">{opt.desc}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {form.deliveryMethod === 'location' && (
            <div className="mt-3.5">
              <Field label="Delivery Address" value={form.deliveryAddress} onChange={(v) => setForm({ ...form, deliveryAddress: v })} placeholder="Street, city, ZIP" />
            </div>
          )}

          <div className="mt-3.5">
            <label className="block font-semibold text-[11.5px] uppercase tracking-[0.08em] text-[#8b857a] mb-1.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Special Requests / Notes
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Anything we should know — timing, access, holding vehicle, substitutions…"
              rows={4}
              maxLength={5000}
              className="w-full border-[1.5px] border-[#cdc7b9] bg-white rounded-lg px-3 py-3 text-[15px] outline-none focus:border-[#0c0c0d] focus:shadow-[0_0_0_4px_rgba(12,12,13,0.05)] resize-y min-h-[84px]"
            />
          </div>

          {submitError && (
            <div className="mt-4 rounded-lg border border-rose-300 bg-rose-50 text-rose-900 text-sm px-3 py-2">
              {submitError}
            </div>
          )}
        </form>
        <div className="px-6 py-4 border-t border-[#e4dfd4] bg-white" style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
          <button
            type="button"
            onClick={() => submitOrder()}
            disabled={!canSubmit || submitting}
            className="w-full bg-[#c39a3f] text-[#0c0c0d] rounded-xl py-4 text-sm font-extrabold tracking-wide disabled:bg-[#2a2a2c] disabled:text-[#5a5a5c] disabled:cursor-not-allowed transition-all hover:-translate-y-0.5 hover:bg-[#d3aa4d]"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            {submitting ? 'Submitting…' : 'Submit reservation request →'}
          </button>
        </div>
      </SlidePanel>

      <SlidePanel show={panel === 'confirm'}>
        <PanelHead title="Sent" sub="" onClose={resetAll} />
        <div className="flex-1 overflow-y-auto px-6 py-8">
          {confirmation && (
            <div className="text-center px-3 py-8">
              <div className="w-[78px] h-[78px] mx-auto rounded-full bg-[#3f7d52] inline-flex items-center justify-center mb-5 shadow-[0_12px_30px_rgba(63,125,82,0.35)]">
                <svg width={38} height={38} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <h2 className="font-black text-3xl tracking-tight mb-3" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Your reservation request is in.
              </h2>
              <p className="text-[#8b857a] max-w-[40ch] mx-auto leading-relaxed">
                Thanks {confirmation.contactName.split(' ')[0]}. Your SirReel agent will confirm availability for the dates you picked and send a quote to{' '}
                <span className="text-[#0c0c0d] font-semibold">{confirmation.contactEmail}</span> shortly.
              </p>
              <p className="text-[#8b857a] max-w-[40ch] mx-auto mt-3.5">
                <span>{confirmation.units}</span> item(s) requested for{' '}
                <span className="text-[#0c0c0d] font-semibold">{confirmation.jobName}</span>.
              </p>
              <div className="inline-block mt-5 bg-[#0c0c0d] text-white font-bold px-5 py-2.5 rounded-full tracking-wider text-sm" style={{ fontFamily: 'Archivo, sans-serif' }}>
                RESERVATION <b className="text-[#c39a3f]">{confirmation.reference}</b>
              </div>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-[#e4dfd4] bg-white" style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
          <button
            onClick={resetAll}
            className="w-full bg-[#0c0c0d] text-white rounded-xl py-4 text-sm font-extrabold tracking-wide hover:-translate-y-0.5 transition-transform"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            Start another reservation
          </button>
        </div>
      </SlidePanel>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// Sub-components — inline for cohesion with the composer state.
// ────────────────────────────────────────────────────────────────

function ItemCard({
  item,
  qty,
  onAdd,
  onSetQty,
}: {
  item: CatalogItem
  qty: number
  onAdd: () => void
  onSetQty: (q: number) => void
}) {
  const isExp = item.type === 'EXPENDABLE'
  const unitTxt = isExp ? 'each' : '/day'
  const inCart = qty > 0
  return (
    <div
      className={`bg-white rounded-[11px] p-3 pl-3.5 flex items-center gap-2.5 shadow-sm transition-all ${
        inCart ? 'border border-[#c39a3f] shadow-[0_0_0_1px_#c39a3f]' : 'border border-[#e4dfd4]'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[14.5px] leading-[1.22] break-words">
          {item.name}
          {isExp && (
            <span className="inline-block font-bold text-[9.5px] tracking-[0.08em] uppercase text-[#a37f2c] bg-[#f6efdc] rounded px-1.5 py-px ml-2 align-middle" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Expendable
            </span>
          )}
        </div>
        <div className="font-semibold text-[12.5px] text-[#8b857a] mt-0.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
          {item.price === 0 ? (
            <span className="text-[#3f7d52] font-extrabold">FREE</span>
          ) : (
            <>
              <b className="text-[#0c0c0d] font-extrabold text-[14px]">{fmtMoney(item.price)}</b> {unitTxt}
            </>
          )}
        </div>
      </div>
      {inCart ? (
        <div className="flex-none flex items-center border-[1.5px] border-[#c39a3f] rounded-[10px] overflow-hidden h-[38px]">
          <button onClick={() => onSetQty(qty - 1)} className="w-[34px] h-full bg-white text-[#a37f2c] text-xl font-bold hover:bg-[#fbf6ea]" aria-label="Decrease">−</button>
          <span className="min-w-[34px] text-center font-extrabold text-[15px]" style={{ fontFamily: 'Archivo, sans-serif' }}>{qty}</span>
          <button onClick={() => onSetQty(qty + 1)} className="w-[34px] h-full bg-white text-[#a37f2c] text-xl font-bold hover:bg-[#fbf6ea]" aria-label="Increase">+</button>
        </div>
      ) : (
        <button
          onClick={onAdd}
          className="flex-none border-[1.5px] border-[#0c0c0d] bg-[#0c0c0d] text-white rounded-[10px] h-[38px] min-w-[62px] px-3 font-bold text-[13px] tracking-wide hover:-translate-y-0.5 transition-transform"
          style={{ fontFamily: 'Archivo, sans-serif' }}
        >
          + Add
        </button>
      )}
    </div>
  )
}

function CartSidebar({
  lines,
  totalUnits,
  totalPerDay,
  onSetQty,
  onReview,
}: {
  lines: CartLine[]
  totalUnits: number
  totalPerDay: number
  onSetQty: (id: string, q: number) => void
  onReview: () => void
}) {
  return (
    <div className="sticky top-[96px] bg-[#0c0c0d] text-white rounded-[18px] overflow-hidden shadow-[0_12px_34px_rgba(12,12,13,0.14)]">
      <div className="px-5 py-4 border-b border-[#242427]">
        <h3 className="font-extrabold text-[17px] tracking-tight flex items-center justify-between" style={{ fontFamily: 'Archivo, sans-serif' }}>
          Your Reservation
          <small className="font-medium text-xs text-[#a8a294]" style={{ fontFamily: '"Hanken Grotesk", sans-serif' }}>
            {totalUnits > 0 ? `${totalUnits} item${totalUnits === 1 ? '' : 's'}` : 'empty'}
          </small>
        </h3>
      </div>
      <div className="max-h-[46vh] overflow-y-auto px-2 py-1.5">
        {lines.length === 0 ? (
          <div className="px-6 py-11 text-center text-[#a8a294]">
            <svg width={34} height={34} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3 opacity-50">
              <circle cx={9} cy={21} r={1} />
              <circle cx={20} cy={21} r={1} />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            <b className="block text-[#e8e3d7] font-bold text-[15px] mb-1" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Nothing added yet
            </b>
            Browse the catalog and tap <em>Add</em>.
          </div>
        ) : (
          lines.map((l) => (
            <div key={l.cartLineId} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-[#191919]">
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold leading-tight truncate">{l.name}</div>
                <div className="text-[11.5px] text-[#a8a294] mt-0.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
                  {l.price === 0 ? 'PRICE ON QUOTE' : `${fmtMoney(l.price)}${l.type === 'EQUIPMENT' ? ' /day' : ' ea'}`}
                </div>
              </div>
              <div className="flex items-center border border-[#2e2e30] rounded-lg overflow-hidden h-[30px]">
                <button onClick={() => onSetQty(l.cartLineId, l.qty - 1)} className="w-7 h-full bg-[#171717] text-[#c39a3f] text-base font-bold hover:bg-[#222]">−</button>
                <span className="min-w-[26px] text-center font-bold text-[13px]" style={{ fontFamily: 'Archivo, sans-serif' }}>{l.qty}</span>
                <button onClick={() => onSetQty(l.cartLineId, l.qty + 1)} className="w-7 h-full bg-[#171717] text-[#c39a3f] text-base font-bold hover:bg-[#222]">+</button>
              </div>
              <div className="font-bold text-[13px] min-w-[54px] text-right" style={{ fontFamily: 'Archivo, sans-serif' }}>
                {fmtTotal(l.price * l.qty)}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="px-5 py-5 border-t border-[#242427] bg-[#0a0a0b]">
        <div className="flex justify-between items-baseline mb-1.5 text-sm text-[#a8a294]">
          <span>Estimated subtotal</span>
          <span>{fmtTotal(totalPerDay)}</span>
        </div>
        <div className="flex justify-between items-baseline mt-2 mb-3.5">
          <span className="font-bold text-sm tracking-wider uppercase" style={{ fontFamily: 'Archivo, sans-serif' }}>Est. / day</span>
          <span className="font-black text-2xl text-[#c39a3f] tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>{fmtTotal(totalPerDay)}</span>
        </div>
        <div className="text-[11px] text-[#8b857a] leading-relaxed mb-3.5">
          Estimate at standard daily rates. Final pricing, taxes, delivery and multi-day discounts confirmed in your quote.
        </div>
        <button
          onClick={onReview}
          disabled={lines.length === 0}
          className="w-full bg-[#c39a3f] text-[#0c0c0d] rounded-xl py-4 text-sm font-extrabold tracking-wide hover:-translate-y-0.5 hover:bg-[#d3aa4d] disabled:bg-[#2a2a2c] disabled:text-[#5a5a5c] disabled:cursor-not-allowed transition-all"
          style={{ fontFamily: 'Archivo, sans-serif' }}
        >
          Review &amp; submit →
        </button>
      </div>
    </div>
  )
}

function ReviewRow({ line, onSetQty }: { line: CartLine; onSetQty: (q: number) => void }) {
  return (
    <div className="flex items-center gap-3 py-3.5 border-b border-[#e4dfd4]">
      <div className="flex-1">
        <div className="font-semibold text-[15px]">{line.name}</div>
        <div className="text-[12.5px] text-[#8b857a] mt-0.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
          {line.category} · {line.price === 0 ? 'FREE' : `${fmtMoney(line.price)}${line.type === 'EQUIPMENT' ? ' /day' : ' ea'}`}
        </div>
      </div>
      <div className="flex items-center border-[1.5px] border-[#cdc7b9] rounded-lg overflow-hidden h-[34px]">
        <button onClick={() => onSetQty(line.qty - 1)} className="w-[30px] h-full bg-white text-[#a37f2c] text-[17px] font-bold">−</button>
        <span className="min-w-[28px] text-center font-extrabold text-sm" style={{ fontFamily: 'Archivo, sans-serif' }}>{line.qty}</span>
        <button onClick={() => onSetQty(line.qty + 1)} className="w-[30px] h-full bg-white text-[#a37f2c] text-[17px] font-bold">+</button>
      </div>
      <div className="font-extrabold text-sm min-w-[58px] text-right" style={{ fontFamily: 'Archivo, sans-serif' }}>
        {fmtTotal(line.price * line.qty)}
      </div>
      <button
        type="button"
        onClick={() => onSetQty(0)}
        className="text-xs text-[#8b857a] underline px-1 hover:text-[#0c0c0d]"
      >
        remove
      </button>
    </div>
  )
}

function Scrim({ show, onClick }: { show: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`fixed inset-0 z-50 bg-[rgba(12,12,13,0.55)] backdrop-blur-sm transition-opacity duration-200 ${
        show ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    />
  )
}

function SlidePanel({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`fixed top-0 right-0 bottom-0 z-[60] bg-[#f4f1ea] flex flex-col w-full sm:w-[560px] shadow-[0_30px_70px_rgba(12,12,13,0.28)] transition-transform duration-300 ease-out ${
        show ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {children}
    </div>
  )
}

function PanelHead({ title, sub, onClose }: { title: string; sub: string; onClose: () => void }) {
  return (
    <div className="px-6 py-5 border-b border-[#e4dfd4] bg-white flex items-center justify-between">
      <div>
        <h2 className="font-black text-[22px] tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
          {title}
        </h2>
        {sub && <div className="text-[13px] text-[#8b857a] mt-px">{sub}</div>}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="border-none bg-[#efeada] w-[38px] h-[38px] rounded-[10px] cursor-pointer text-xl text-[#0c0c0d] inline-flex items-center justify-center hover:bg-[#e6e0cf]"
        aria-label="Close"
      >
        ✕
      </button>
    </div>
  )
}

function SegTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-extrabold text-[13px] tracking-[0.1em] uppercase mt-7 mb-3 flex items-center gap-2.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
      {children}
      <span className="flex-1 h-[1.5px] bg-[#e4dfd4]" />
    </div>
  )
}

function Field({
  label,
  required,
  type = 'text',
  value,
  onChange,
  placeholder,
}: {
  label: string
  required?: boolean
  type?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-semibold text-[11.5px] tracking-[0.08em] uppercase text-[#8b857a]" style={{ fontFamily: 'Archivo, sans-serif' }}>
        {label}
        {required && <span className="text-[#a37f2c] ml-1">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="border-[1.5px] border-[#cdc7b9] bg-white rounded-lg px-3.5 py-3 text-[15px] outline-none focus:border-[#0c0c0d] focus:shadow-[0_0_0_4px_rgba(12,12,13,0.05)]"
      />
    </div>
  )
}
