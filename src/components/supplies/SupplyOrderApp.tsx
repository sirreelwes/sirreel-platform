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
import { useSupplyCart, type CartLine, type AddToCartArgs, type ItemKind, lineEstimate, rentalDaysBetween } from '@/hooks/useSupplyCart'
import { mapCatalogToSections, rankSearchResults } from '@/lib/site/publicSupplySections'

interface CatalogItem {
  id: string
  name: string
  price: number
  /** Intentional no-charge inclusion (e.g. recycle bins). Shown as
   *  "Included" and NOT orderable — it comes with the order, not a free line. */
  included?: boolean
  /** Public scoped image-proxy path, or null → placeholder. Never a raw blob URL. */
  image?: string | null
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

interface VehicleCategoryItem {
  id: string
  name: string
  slug: string
  subtitle: string | null
  photoUrl: string | null
  dailyRate: number | null
  sortOrder: number
}
interface VehicleCategoriesResponse {
  categories: VehicleCategoryItem[]
  totals: { categories: number }
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

// Role chips on the details form. Full labels — these exact strings
// flow into contact.role and the CRM capture maps them via
// mapTitleToRole (Producer/PM/PC/APC→PC/Art Coordinator all bucket
// 1:1; PRODUCTION_MANAGER added to PersonRole 2026-07-05).
const ROLE_PRESETS = [
  'Producer',
  'Production Manager',
  'Production Coordinator',
  'Assistant Production Coordinator',
  'Art Coordinator',
] as const

const DELIVERY_OPTIONS: { id: DeliveryMethod; label: string; desc: string }[] = [
  { id: 'will-call', label: 'Will Call Pickup', desc: 'You collect from SirReel' },
  { id: 'sirreel-vehicle', label: 'Load in SirReel Vehicle', desc: 'Loaded into your rental' },
  { id: 'stage', label: 'SirReel Stage Delivery', desc: 'Delivered to a SirReel stage' },
  { id: 'location', label: 'Location Delivery', desc: 'Delivered to your location' },
]

function fmtMoney(n: number): string {
  // Never render "FREE" to a client — a $0 is either an "Included" item
  // (handled separately) or a price-on-quote line. Bare $0 is the safe floor.
  if (n === 0) return '$0'
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

  // ── Vehicle catalog ───────────────────────────────────────────
  // Loaded once on mount. Vehicles aren't search-filtered against the
  // text query (the public set is small — ~13 categories — and the
  // search box is supply-shaped); they always render in the Featured
  // section. If the agent has typed a non-empty query, the vehicle
  // section is hidden so the search experience stays focused.
  const [vehicles, setVehicles] = useState<VehicleCategoryItem[] | null>(null)
  const [vehiclesError, setVehiclesError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/public/vehicle-categories', { cache: 'no-store' })
      .then(async (r) => {
        const json = (await r.json().catch(() => null)) as VehicleCategoriesResponse | null
        if (cancelled) return
        if (!r.ok || !json) {
          setVehiclesError(`HTTP ${r.status}`)
          setVehicles([])
        } else {
          setVehicles(json.categories)
        }
      })
      .catch((err) => {
        if (cancelled) return
        setVehiclesError(err instanceof Error ? err.message : 'fetch failed')
        setVehicles([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // ── Reorder (magic-link past orders) ──────────────────────────
  // History NEVER renders unverified: /api/public/reorder/history is
  // 401 without the person-session cookie; 'anon' shows the magic-link
  // request bar instead. A valid session (30-day cookie from a prior
  // link click) skips the email step entirely.
  interface ReorderOrder {
    id: string
    orderNumber: string
    jobName: string
    startDate: string | null
    endDate: string | null
    itemCount: number
    lines: { itemKind: ItemKind; itemId: string; name: string; qty: number; available: boolean; price: number; type: string; category: string }[]
  }
  const [reorder, setReorder] = useState<
    | { state: 'loading' }
    | { state: 'anon' }
    | { state: 'verified'; person: { name: string; email: string; phone: string | null; role: string | null }; orders: ReorderOrder[] }
  >({ state: 'loading' })
  const [toggledOrders, setToggledOrders] = useState<Set<string>>(new Set())
  const [magicEmail, setMagicEmail] = useState('')
  const [magicMsg, setMagicMsg] = useState<string | null>(null)
  const [magicSending, setMagicSending] = useState(false)
  const prefilledRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/public/reorder/history', { cache: 'no-store' })
      .then(async (r) => {
        if (cancelled) return
        if (r.status === 401) { setReorder({ state: 'anon' }); return }
        if (!r.ok) { setReorder({ state: 'anon' }); return }
        const d = await r.json()
        setReorder({ state: 'verified', person: d.person, orders: d.orders ?? [] })
      })
      .catch(() => { if (!cancelled) setReorder({ state: 'anon' }) })
    return () => { cancelled = true }
  }, [])

  const requestMagicLink = async () => {
    if (magicSending || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(magicEmail.trim())) return
    setMagicSending(true)
    try {
      const res = await fetch('/api/portal/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: magicEmail.trim(), next: '/order/supplies' }),
      })
      const d = await res.json().catch(() => null)
      setMagicMsg(d?.message ?? "If that email is on file, we've sent a sign-in link.")
    } catch {
      setMagicMsg("If that email is on file, we've sent a sign-in link.")
    } finally {
      setMagicSending(false)
    }
  }

  // ── Cart ──────────────────────────────────────────────────────
  const {
    lines,
    totalUnits,
    totalEstimate,
    hasEquipment,
    hasPriceOnQuote,
    addToCart,
    setQty,
    setDates,
    removeLine,
    mergeOrderLines,
    unmergeOrder,
    resetCart,
  } = useSupplyCart()

  // Toggle a past order into/out of the cart. ON merges available
  // lines (fresh server rates already on the payload; dates default
  // like any manual add — the old order's dates are NOT copied) and
  // prefills EMPTY contact fields from the Person on first use.
  // OFF removes only untouched order-owned lines (see useSupplyCart).
  const toggleOrder = (order: ReorderOrder) => {
    const isOn = toggledOrders.has(order.id)
    if (isOn) {
      unmergeOrder(order.id)
      setToggledOrders((prev) => { const n = new Set(prev); n.delete(order.id); return n })
      return
    }
    const dates = defaultDatesForAdd(form)
    const incoming: AddToCartArgs[] = order.lines
      .filter((l) => l.available)
      .map((l) => ({
        itemKind: l.itemKind, itemId: l.itemId, qty: l.qty,
        pickupDate: dates.pickupDate, returnDate: dates.returnDate,
        name: l.name, price: l.price, type: l.type, category: l.category,
      }))
    mergeOrderLines(order.id, incoming)
    setToggledOrders((prev) => new Set(prev).add(order.id))
    if (!prefilledRef.current && reorder.state === 'verified') {
      prefilledRef.current = true
      const p = reorder.person
      setForm((f) => ({
        ...f,
        contactName: f.contactName || p.name,
        email: f.email || p.email,
        phone: f.phone || (p.phone ?? ''),
        role: f.role || (p.role ?? ''),
      }))
    }
  }

  // Per-vehicle window helpers — bound to the VehicleCard so each
  // window row addresses its own cart line via the stable
  // cartLineId. The card no longer has its own date-editing surface
  // shared across windows.
  type WindowOps = {
    onSetWindowDates: (cartLineId: string, pickup: string, returnD: string) => void
    onSetWindowQty: (cartLineId: string, q: number) => void
    onRemoveWindow: (cartLineId: string) => void
  }
  const windowOps: WindowOps = {
    onSetWindowDates: (id, p, r) => setDates(id, p, r),
    onSetWindowQty: (id, q) => setQty(id, q),
    onRemoveWindow: (id) => removeLine(id),
  }

  // touchedLineIds — line ids the agent has manually changed dates on.
  // Used by category-level date cascade in the Review panel:
  // category-level pickup/return changes propagate to every line in
  // the category EXCEPT those in this set. Pruned whenever lines
  // change so stale ids don't accumulate across removes / re-keys.
  const [touchedLineIds, setTouchedLineIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    setTouchedLineIds((prev) => {
      if (prev.size === 0) return prev
      const live = new Set(lines.map((l) => l.cartLineId))
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (live.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [lines])

  function setLineDatesTouched(cartLineId: string, pickup: string, returnD: string) {
    setDates(cartLineId, pickup, returnD)
    // setDates re-keys the line — the new key is cartLineKey(kind,id,pickup,returnD).
    // Reconstruct it from the current line so we mark the post-rekey id as touched.
    const line = lines.find((l) => l.cartLineId === cartLineId)
    if (!line) return
    const newKey = `${line.itemKind}:${line.itemId}:${pickup}:${returnD}`
    setTouchedLineIds((prev) => {
      const next = new Set(prev)
      next.delete(cartLineId)
      next.add(newKey)
      return next
    })
  }

  function cascadeCategoryDates(categoryLines: CartLine[], pickup: string, returnD: string) {
    for (const l of categoryLines) {
      if (touchedLineIds.has(l.cartLineId)) continue
      if (l.pickupDate === pickup && l.returnDate === returnD) continue
      setDates(l.cartLineId, pickup, returnD)
    }
  }

  // Lines grouped by category for the Review panel. Vehicles ordered
  // first (most prominent reservation element); then categories in
  // first-line-add order so the panel reads in the order the agent
  // built it.
  const linesByCategory = useMemo(() => {
    const groups = new Map<string, CartLine[]>()
    for (const l of lines) {
      const key = l.itemKind === 'VEHICLE' ? 'Vehicles' : (l.category || 'Other')
      const slot = groups.get(key) ?? []
      slot.push(l)
      groups.set(key, slot)
    }
    return [...groups.entries()].sort((a, b) => {
      if (a[0] === 'Vehicles') return -1
      if (b[0] === 'Vehicles') return 1
      return 0
    })
  }, [lines])
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
  // Role chips: form.role stays the single source of truth (payload
  // unchanged) — this only tracks whether the "Other" text input is
  // revealed. A preset chip writes its full label into form.role.
  const [roleOther, setRoleOther] = useState(false)
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

  // Curated public sections (lib/site/publicSupplySections) — the
  // form renders these instead of raw InventoryCategory groups.
  // Unmapped categories never render publicly. When a text query is
  // active the API has already filtered items; sections re-map the
  // filtered result so search hits stay inside the curated framing.
  const sections = useMemo(
    () => (data ? mapCatalogToSections(data.categories) : []),
    [data],
  )
  // Browse mode: curated sections, optionally narrowed by the active
  // filter button. Search mode replaces this entirely (below).
  const visibleSections = useMemo(() => {
    if (activeCat === 'All') return sections
    return sections.filter((s) => s.label === activeCat)
  }, [sections, activeCat])

  // Search mode: ONE ranked flat list over EVERY publicVisible item
  // the API matched — section mapping and the active filter button do
  // not scope it (typing intent beats browse curation). Items from
  // unmapped categories surface here and add to cart normally; they
  // just have no browse section. Ranking in rankSearchResults.
  const searchResults = useMemo(() => {
    if (!debouncedQuery || !data) return null
    return rankSearchResults(data.categories.flatMap((c) => c.items), debouncedQuery)
  }, [data, debouncedQuery])

  // What the grid actually renders — ranked results while searching,
  // curated sections otherwise.
  const displaySections = useMemo(() => {
    if (debouncedQuery) {
      return searchResults && searchResults.length > 0
        ? [{ label: `Results for “${debouncedQuery}”`, items: searchResults }]
        : []
    }
    return visibleSections
  }, [debouncedQuery, searchResults, visibleSections])

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
    <div className="min-h-screen overflow-x-hidden bg-[#f4f1ea] text-[#0c0c0d]" style={{ fontFamily: '"Hanken Grotesk", Inter, system-ui, sans-serif' }}>
      {/* ── COMMAND BAR ──────────────────────────────────────────
          Sticky dark bar: mark+wordmark · pickup/return dates (THE
          single source — the details panel shows a read-only summary)
          · cart summary (count + $, tap = open cart). Two rows under
          sm so dates keep full-width tap targets at 390px. */}
      <header className="sticky top-0 z-40 bg-[#0c0c0d] text-white">
        <div className="max-w-[1480px] mx-auto px-4 sm:px-5">
          <div className="h-[56px] sm:h-[64px] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-[9px] bg-[#c39a3f] text-[#0c0c0d] font-black text-[19px] inline-flex items-center justify-center flex-none" style={{ fontFamily: 'Archivo, sans-serif' }}>S</span>
              <span className="font-black text-xl tracking-tight whitespace-nowrap" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Sir<span className="text-[#c39a3f]">Reel</span>
              </span>
            </div>
            {/* dates — center, desktop */}
            <div className="hidden sm:flex items-center gap-2">
              <label className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#a8a294]" style={{ fontFamily: 'Archivo, sans-serif' }}>Pickup</span>
                <input
                  type="date"
                  value={form.pickupDate}
                  onChange={(e) => setForm({ ...form, pickupDate: e.target.value })}
                  className="bg-white/10 border border-white/20 rounded-lg px-2.5 h-[38px] text-[13px] text-white outline-none focus:border-[#c39a3f] [color-scheme:dark]"
                />
              </label>
              <span className="text-[#6f6a60]">→</span>
              <label className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#a8a294]" style={{ fontFamily: 'Archivo, sans-serif' }}>Return</span>
                <input
                  type="date"
                  value={form.returnDate}
                  min={form.pickupDate || undefined}
                  onChange={(e) => setForm({ ...form, returnDate: e.target.value })}
                  className="bg-white/10 border border-white/20 rounded-lg px-2.5 h-[38px] text-[13px] text-white outline-none focus:border-[#c39a3f] [color-scheme:dark]"
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              {signInHref && (
                <Link
                  href={signInHref}
                  aria-label="Sign in"
                  title="Sign in"
                  className="hidden sm:inline-flex text-[#a8a294] hover:text-white w-9 h-9 items-center justify-center"
                >
                  <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx={12} cy={7} r={4} />
                  </svg>
                </Link>
              )}
              <button
                onClick={() => lines.length > 0 && setPanel('sheet')}
                className="flex items-center gap-2 bg-white text-[#0c0c0d] rounded-full pl-3.5 pr-2 h-[40px] text-[13px] font-bold"
                style={{ fontFamily: 'Archivo, sans-serif' }}
                aria-label="Open reservation"
              >
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx={9} cy={21} r={1} />
                  <circle cx={20} cy={21} r={1} />
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                </svg>
                <span className="hidden sm:inline">{totalUnits}</span>
                <span className="bg-[#0c0c0d] text-[#c39a3f] rounded-full px-2.5 h-[28px] inline-flex items-center text-[12.5px] font-extrabold">
                  {fmtTotal(totalEstimate)}
                </span>
              </button>
            </div>
          </div>
          {/* dates — full-width row at 390px */}
          <div className="sm:hidden pb-2.5 flex items-center gap-2">
            <input
              type="date"
              value={form.pickupDate}
              onChange={(e) => setForm({ ...form, pickupDate: e.target.value })}
              aria-label="Pickup date"
              className="flex-1 min-w-0 bg-white/10 border border-white/20 rounded-lg px-2.5 h-[44px] text-[14px] text-white outline-none focus:border-[#c39a3f] [color-scheme:dark]"
            />
            <span className="text-[#6f6a60] flex-none">→</span>
            <input
              type="date"
              value={form.returnDate}
              min={form.pickupDate || undefined}
              onChange={(e) => setForm({ ...form, returnDate: e.target.value })}
              aria-label="Return date"
              className="flex-1 min-w-0 bg-white/10 border border-white/20 rounded-lg px-2.5 h-[44px] text-[14px] text-white outline-none focus:border-[#c39a3f] [color-scheme:dark]"
            />
          </div>
        </div>
      </header>

      {/* ── HERO ─────────────────────────────────────────────── */}
      {/* Minimal by design (2026-07-05): eyebrow, title, and the
          agent-confirmation line. No blurb, no steps, no side copy. */}
      <section className="bg-[#0c0c0d] text-white border-t border-white/5">
        <div className="max-w-[1480px] mx-auto px-4 sm:px-5 py-7 sm:py-9">
          <h1 className="font-black tracking-tight leading-[0.95] text-[30px] sm:text-[42px] md:text-[50px] max-w-[18ch]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            Let&rsquo;s get your gear and vehicles lined up
          </h1>
          <p className="mt-2.5 text-[#a8a294] text-[13.5px]">
            Final Pricing and Availability must be confirmed by SirReel Agent
          </p>

          {/* ── Reorder: magic-link request (anon) / past-order toggles
              (verified). History NEVER renders unverified — the strip
              exists only when the server accepted the session cookie. */}
          {reorder.state === 'anon' && (
            <div className="mt-5 max-w-[560px]">
              <div className="text-[13px] font-semibold text-[#e8e3d7] mb-2" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Ordered with us before? Get a magic link to your past orders
              </div>
              {magicMsg ? (
                <div className="text-[13px] text-[#c39a3f]">{magicMsg}</div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={magicEmail}
                    onChange={(e) => setMagicEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') requestMagicLink() }}
                    placeholder="you@company.com"
                    className="flex-1 min-w-0 bg-white/10 border border-white/20 rounded-lg px-3.5 py-2.5 text-[14px] text-white placeholder:text-[#a8a294] outline-none focus:border-[#c39a3f]"
                  />
                  <button
                    onClick={requestMagicLink}
                    disabled={magicSending}
                    className="flex-none bg-[#c39a3f] text-[#0c0c0d] rounded-lg px-4 py-2.5 text-[13px] font-extrabold disabled:opacity-50"
                    style={{ fontFamily: 'Archivo, sans-serif' }}
                  >
                    {magicSending ? 'Sending…' : 'Send link'}
                  </button>
                </div>
              )}
            </div>
          )}
          {reorder.state === 'verified' && reorder.orders.length > 0 && (
            <div className="mt-5">
              <div className="text-[12px] font-semibold tracking-[0.18em] uppercase text-[#c39a3f] mb-2.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Your past orders — tap to add to this reservation
              </div>
              <div className="flex flex-wrap gap-2">
                {reorder.orders.map((o) => {
                  const on = toggledOrders.has(o.id)
                  const unavailable = o.lines.filter((l) => !l.available).length
                  return (
                    <button
                      key={o.id}
                      onClick={() => toggleOrder(o)}
                      className={`text-left border-[1.5px] rounded-xl px-3.5 py-2.5 transition-all ${
                        on ? 'border-[#c39a3f] bg-[#c39a3f]/15' : 'border-white/20 bg-white/5 hover:border-white/45'
                      }`}
                    >
                      <div className="text-[13.5px] font-bold text-white" style={{ fontFamily: 'Archivo, sans-serif' }}>
                        {on ? '✓ ' : '+ '}{o.jobName}
                      </div>
                      <div className="text-[11.5px] text-[#a8a294] mt-0.5">
                        {o.startDate ?? '—'}{o.endDate && o.endDate !== o.startDate ? ` – ${o.endDate}` : ''} · {o.itemCount} item{o.itemCount === 1 ? '' : 's'}
                        {unavailable > 0 && <span className="text-[#c39a3f]"> · {unavailable} no longer available</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── SHELL ────────────────────────────────────────────── */}
      <div className="max-w-[1480px] mx-auto px-5 relative">
        <div className="grid gap-8 pt-7 pb-[120px] lg:grid-cols-[1fr_374px] items-start">
          {/* LEFT: search + pills + catalog */}
          {/* min-w-0 lets <main> shrink inside the lg grid track instead
              of forcing its 1fr column wider than the viewport. Without
              it, long item names + the auto-fill catalog grid push the
              page horizontally and clip the chip strip. */}
          <main className="min-w-0">
            <div className="py-4 pb-1">
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
            </div>

            {/* catalog grid */}
            <div className="mt-3">
              {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-900 text-sm px-3 py-2 mb-4">
                  Couldn&apos;t load the catalog: {error}
                </div>
              )}
              {!loading && data && displaySections.length === 0 && (
                <div className="py-12 text-center text-[#8b857a]">
                  <b className="block text-lg text-[#1a1a1c] mb-1.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
                    Nothing matches &ldquo;{debouncedQuery}&rdquo;.
                  </b>
                  Try a broader term, or browse by category above.
                </div>
              )}

              {/* ── FEATURED RESERVE VEHICLES ─────────────────────
                  Hidden while the agent is searching the supply
                  catalog (text query non-empty) so the search results
                  stay focused. Vehicles are price-on-quote by default
                  (dailyRate null) — the tile labels them as such. */}
              {!debouncedQuery && vehicles && vehicles.length > 0 && (
                <section className="mt-2 scroll-mt-[200px]">
                  <div className="flex items-baseline gap-3.5 mb-3.5">
                    <h2 className="font-extrabold tracking-tight text-[23px] text-[#0c0c0d]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                      Reserve Vehicles
                    </h2>
                    <span className="flex-1 h-[2px] bg-[#c39a3f] opacity-40" />
                    <span className="font-semibold text-[12px] text-[#8b857a] tracking-wider" style={{ fontFamily: 'Archivo, sans-serif' }}>
                      {vehicles.length}
                    </span>
                  </div>
                  <p className="text-[13.5px] text-[#5b554b] -mt-1 mb-3.5 max-w-[68ch]">
                    Pick a vehicle class and the window you need it. Reservation requests confirm availability for those dates and come back with a firm quote.
                  </p>
                  <VehicleRail>
                    {vehicles.map((v) => {
                      const slot = cartByItemId.get(v.id)
                      const windows = slot?.lines ?? []
                      return (
                        <VehicleCard
                          key={v.id}
                          vehicle={v}
                          windows={windows}
                          formDefaults={defaultDatesForAdd(form)}
                          onAdd={(pickupDate, returnDate) => {
                            addToCart({
                              itemKind: 'VEHICLE',
                              itemId: v.id,
                              name: v.name + (v.subtitle ? ` (${v.subtitle})` : ''),
                              price: v.dailyRate ?? 0,
                              type: 'VEHICLE',
                              category: 'Vehicle',
                              pickupDate,
                              returnDate,
                            })
                          }}
                          onSetWindowDates={windowOps.onSetWindowDates}
                          onSetWindowQty={windowOps.onSetWindowQty}
                          onRemoveWindow={windowOps.onRemoveWindow}
                        />
                      )
                    })}
                  </VehicleRail>
                  {vehiclesError && (
                    <div className="mt-2 text-[11px] text-rose-700">
                      Couldn&rsquo;t load vehicles: {vehiclesError}
                    </div>
                  )}
                </section>
              )}

              {/* ── SUPPLY SECTIONS ──────────────────────────────
                  Section header + the 7 curated filter buttons sit
                  DIRECTLY above the item grid (below vehicles), so
                  filtering visibly anchors to what it filters. The
                  buttons list the curated sections from
                  lib/site/publicSupplySections — not raw categories.
                  Clicking the active section again clears back to all.
                  Hidden while searching (query overrides sections). */}
              {!debouncedQuery && data && (
                <div className="mt-9">
                  <div className="flex items-baseline gap-3.5 mb-3.5">
                    <h2 className="font-extrabold tracking-tight text-[23px] text-[#0c0c0d]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                      Production Supplies
                    </h2>
                    <span className="flex-1 h-[2px] bg-[#c39a3f] opacity-40" />
                  </div>
                  <div className="sticky top-[110px] sm:top-[64px] z-20 bg-[#f4f1ea] py-2 -my-2 flex flex-wrap gap-2">
                    {/* Sticky under the command bar once the supply area
                        is scrolled into. Buttons come from the COMPUTED
                        sections, not the static config — a category whose
                        last public item is hidden loses its button
                        automatically. */}
                    {sections.map((s) => {
                      const isActive = s.label === activeCat
                      return (
                        <button
                          key={s.label}
                          onClick={() => {
                            setActiveCat(isActive ? 'All' : s.label)
                            setQuery('')
                          }}
                          className={`flex-none border-[1.5px] rounded-full px-4 py-1.5 text-[12.5px] font-semibold tracking-tight whitespace-nowrap transition-all ${
                            isActive
                              ? 'bg-[#0c0c0d] text-white border-[#0c0c0d]'
                              : 'bg-transparent text-[#1a1a1c] border-[#cdc7b9] hover:border-[#0c0c0d]'
                          }`}
                          style={{ fontFamily: 'Archivo, sans-serif' }}
                        >
                          {s.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {displaySections.map((cat) => (
                <section key={cat.label} className="mt-8 scroll-mt-[200px]">
                  <div className="flex items-baseline gap-3.5 mb-3.5">
                    <h2 className="font-extrabold tracking-tight text-[23px]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                      {cat.label}
                    </h2>
                    <span className="flex-1 h-[2px] bg-[#0c0c0d] opacity-10" />
                    <span className="font-semibold text-[12px] text-[#8b857a] tracking-wider" style={{ fontFamily: 'Archivo, sans-serif' }}>
                      {cat.items.length}
                    </span>
                  </div>
                  <div className="bg-white rounded-xl border border-[#e4dfd4] divide-y divide-[#efeada] overflow-hidden">
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
              totalEstimate={totalEstimate}
              hasPriceOnQuote={hasPriceOnQuote}
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
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold" style={{ fontFamily: 'Archivo, sans-serif' }}>{totalUnits} item{totalUnits === 1 ? '' : 's'}</span>
            <span className="text-[#6f6a60]">·</span>
            <span className="font-extrabold text-lg text-[#c39a3f]" style={{ fontFamily: 'Archivo, sans-serif' }}>{fmtTotal(totalEstimate)}</span>
          </div>
          <button
            onClick={() => setPanel('sheet')}
            className="bg-[#d97706] text-white rounded-lg px-5 py-3 text-sm font-extrabold"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            Review →
          </button>
        </div>
      )}

      {/* Scrim + panels */}
      <Scrim show={panel !== 'none'} onClick={() => setPanel('none')} />

      <SlidePanel show={panel === 'sheet'}>
        <PanelHead title="Your Reservation" sub={lines.length ? `${totalUnits} item${totalUnits === 1 ? '' : 's'} · ${linesByCategory.length} categor${linesByCategory.length === 1 ? 'y' : 'ies'}` : 'Review and adjust quantities'} onClose={() => setPanel('none')} />
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {lines.length === 0 ? (
            <div className="py-16 text-center text-[#8b857a]">
              <b className="block text-[#0c0c0d] font-extrabold mb-1" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Your reservation is empty
              </b>
              Add vehicles or supplies to continue.
            </div>
          ) : (
            linesByCategory.map(([category, categoryLines]) => (
              <CategorySection
                key={category}
                category={category}
                lines={categoryLines}
                touchedLineIds={touchedLineIds}
                onSetQty={setQty}
                onRemove={removeLine}
                onSetLineDates={setLineDatesTouched}
                onCascadeCategoryDates={(p, r) => cascadeCategoryDates(categoryLines, p, r)}
              />
            ))
          )}
        </div>
        <div className="px-6 py-4 border-t border-[#e4dfd4] bg-white" style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
          <div className="flex justify-between items-baseline mb-1">
            <span className="font-bold text-sm uppercase tracking-wider" style={{ fontFamily: 'Archivo, sans-serif' }}>Est. total</span>
            <span className="font-black text-2xl text-[#a37f2c] tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>{fmtTotal(totalEstimate)}</span>
          </div>
          {hasPriceOnQuote && (
            <div className="text-[11.5px] text-[#8b857a] mb-2.5">
              Some lines are priced on quote — not included in this estimate.
            </div>
          )}
          <button
            onClick={() => setPanel('details')}
            disabled={lines.length === 0}
            className="w-full bg-[#d97706] text-white rounded-xl py-4 text-sm font-extrabold tracking-wide disabled:bg-[#2a2a2c] disabled:text-[#5a5a5c] disabled:cursor-not-allowed transition-colors hover:bg-[#e2830d] mt-2"
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
            <div className="sm:col-span-2">
              <label className="block font-semibold text-[11.5px] uppercase tracking-[0.08em] text-[#8b857a] mb-1.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Role / Position
              </label>
              <div className="flex flex-wrap gap-2">
                {ROLE_PRESETS.map((r) => {
                  const isSel = !roleOther && form.role === r
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => { setRoleOther(false); setForm({ ...form, role: isSel ? '' : r }) }}
                      className={`border-[1.5px] rounded-full px-3.5 py-2 text-[13px] font-semibold transition-all ${
                        isSel ? 'border-[#c39a3f] bg-[#fcf8ee] text-[#0c0c0d] shadow-[0_0_0_1px_#c39a3f]' : 'border-[#cdc7b9] bg-white text-[#1a1a1c] hover:border-[#1a1a1c]'
                      }`}
                      style={{ fontFamily: 'Archivo, sans-serif' }}
                    >
                      {r}
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={() => {
                    if (roleOther) { setRoleOther(false); setForm({ ...form, role: '' }) }
                    else { setRoleOther(true); setForm({ ...form, role: '' }) }
                  }}
                  className={`border-[1.5px] rounded-full px-3.5 py-2 text-[13px] font-semibold transition-all ${
                    roleOther ? 'border-[#c39a3f] bg-[#fcf8ee] text-[#0c0c0d] shadow-[0_0_0_1px_#c39a3f]' : 'border-[#cdc7b9] bg-white text-[#1a1a1c] hover:border-[#1a1a1c]'
                  }`}
                  style={{ fontFamily: 'Archivo, sans-serif' }}
                >
                  Other
                </button>
              </div>
              {roleOther && (
                <input
                  type="text"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  placeholder="Your role"
                  autoFocus
                  className="mt-2 w-full sm:max-w-[320px] border-[1.5px] border-[#cdc7b9] bg-white rounded-lg px-3 py-2.5 text-[15px] outline-none focus:border-[#0c0c0d] focus:shadow-[0_0_0_4px_rgba(12,12,13,0.05)]"
                />
              )}
            </div>
            <Field label="Email" required type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="you@company.com" />
            <Field label="Phone" type="tel" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="(818) 000-0000" />
            {/* Dates live in the top command bar (single source) — this
                is the read-only confirmation of what was picked there. */}
            <div className="sm:col-span-2 flex items-center justify-between rounded-lg border-[1.5px] border-[#cdc7b9] bg-white px-3.5 py-3">
              <div>
                <div className="font-semibold text-[11.5px] tracking-[0.08em] uppercase text-[#8b857a]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                  Dates<span className="text-[#a37f2c] ml-1">*</span>
                </div>
                <div className={`text-[15px] font-semibold mt-0.5 ${form.pickupDate ? 'text-[#0c0c0d]' : 'text-[#a3431b]'}`}>
                  {form.pickupDate
                    ? `${form.pickupDate}${form.returnDate ? ` → ${form.returnDate}` : ''}`
                    : 'Pick your dates in the top bar'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPanel('none')}
                className="text-[12px] font-bold text-[#a37f2c] underline underline-offset-2"
                style={{ fontFamily: 'Archivo, sans-serif' }}
              >
                Edit dates
              </button>
            </div>
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
            className="w-full bg-[#d97706] text-white rounded-xl py-4 text-sm font-extrabold tracking-wide disabled:bg-[#2a2a2c] disabled:text-[#5a5a5c] disabled:cursor-not-allowed transition-colors hover:bg-[#e2830d]"
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
  // Dense pick-list row. The stepper IS the add-to-cart: at qty 0 the
  // "+" fires onAdd (new cart line at the bar's dates); above 0 both
  // buttons drive setQty on the existing line. 44px tap targets.
  const isExp = item.type === 'EXPENDABLE'
  const unitTxt = isExp ? 'ea' : '/day'
  const inCart = qty > 0
  return (
    <div className={`flex items-center gap-3 px-3 sm:px-4 min-h-[56px] py-1.5 ${inCart ? 'bg-[#fcf8ee]' : 'bg-white'}`}>
      {item.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.image}
          alt=""
          loading="lazy"
          className="flex-none w-10 h-10 rounded-[8px] object-cover bg-[#f0eadb]"
        />
      ) : (
        <div className="flex-none w-10 h-10 rounded-[8px] bg-[#f6efdc] flex items-center justify-center">
          <span className="text-[#c39a3f] font-black text-[15px] opacity-70" style={{ fontFamily: 'Archivo, sans-serif' }}>S</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-[14px] leading-[1.25] line-clamp-2 sm:line-clamp-1 sm:truncate block">
          {item.name}
          {isExp && (
            <span className="inline-block font-bold text-[9px] tracking-[0.08em] uppercase text-[#a37f2c] ml-1.5 align-middle" style={{ fontFamily: 'Archivo, sans-serif' }}>
              exp
            </span>
          )}
        </span>
      </div>
      <div className="flex-none text-right text-[13px] font-semibold text-[#8b857a] whitespace-nowrap" style={{ fontFamily: 'Archivo, sans-serif' }}>
        {item.included ? (
          <span className="font-bold text-[#a37f2c] text-[11px] uppercase tracking-wide">Included</span>
        ) : (
          <>
            <b className="text-[#a37f2c] font-extrabold text-[14px]">{fmtMoney(item.price)}</b>
            <span className="text-[11px]"> {unitTxt}</span>
          </>
        )}
      </div>
      {!item.included && (
        <div className={`flex-none flex items-center rounded-[10px] overflow-hidden border-[1.5px] ${inCart ? 'border-[#c39a3f]' : 'border-[#cdc7b9]'}`}>
          <button
            onClick={() => inCart && onSetQty(qty - 1)}
            disabled={!inCart}
            className="w-11 h-11 bg-white text-[#a37f2c] text-xl font-bold disabled:text-[#cdc7b9] hover:bg-[#fbf6ea]"
            aria-label="Decrease quantity"
          >
            −
          </button>
          <span className={`min-w-[30px] text-center font-extrabold text-[15px] ${inCart ? 'text-[#0c0c0d]' : 'text-[#cdc7b9]'}`} style={{ fontFamily: 'Archivo, sans-serif' }}>
            {qty}
          </span>
          <button
            onClick={() => (inCart ? onSetQty(qty + 1) : onAdd())}
            className="w-11 h-11 bg-white text-[#a37f2c] text-xl font-bold hover:bg-[#fbf6ea]"
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
      )}
    </div>
  )
}

// VehicleRail — single horizontal, pannable row of vehicle cards.
//
// Replaces the wrapping grid so the supply catalog below sits one row
// higher and stays visible without scrolling past a tall grid. The rail
// scrolls left↔right only (overflow-y hidden), so a vertical wheel/trackpad
// gesture bubbles up to the page instead of being trapped here; horizontal
// trackpad / shift-wheel pans the rail. Cream edge-fades cue that more
// cards sit off-screen and fade in/out with scroll position; a slim gold
// scrollbar reinforces it on browsers that render one.
function VehicleRail({ children }: { children: React.ReactNode }) {
  const railRef = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)
  const sync = useCallback(() => {
    const el = railRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setAtStart(el.scrollLeft <= 1)
    setAtEnd(el.scrollLeft >= max - 1)
  }, [])
  useEffect(() => {
    const el = railRef.current
    if (!el) return
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [sync])
  return (
    <div className="relative">
      <div
        ref={railRef}
        onScroll={sync}
        className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2 snap-x snap-mandatory xl:grid xl:overflow-visible xl:snap-none xl:pb-0 [scrollbar-width:thin] [scrollbar-color:#c39a3f_transparent]"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
      >
        {children}
      </div>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-[#f4f1ea] to-transparent transition-opacity duration-200 ${atStart ? 'opacity-0' : 'opacity-100'}`}
      />
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-[#f4f1ea] to-transparent transition-opacity duration-200 ${atEnd ? 'opacity-0' : 'opacity-100'}`}
      />
    </div>
  )
}

// VehicleCard — Featured section tile.
//
// Each existing window already in the cart for this vehicle renders
// as its own editable row (pickup, return, qty stepper, remove ×).
// Each row binds to its own cart line via the stable cartLineId.
//
// Below the rows sits a "next window" form: a fresh pickup/return
// pair + an "+ Add window" button that commits the form to the cart
// and then resets the form's date inputs back to the seed defaults.
// Resetting is the LINCHPIN of the fix — without it, two clicks
// without changing dates produced the same cart key and merged into
// a qty bump on the existing window rather than appending a new line.
//
// First-time state (zero windows): the form is the only thing
// visible, with the button labeled "+ Reserve". Same form shape,
// different copy.
function VehicleCard({
  vehicle,
  windows,
  formDefaults,
  onAdd,
  onSetWindowDates,
  onSetWindowQty,
  onRemoveWindow,
}: {
  vehicle: VehicleCategoryItem
  windows: CartLine[]
  formDefaults: { pickupDate: string; returnDate: string }
  onAdd: (pickupDate: string, returnDate: string) => void
  onSetWindowDates: (cartLineId: string, pickup: string, returnD: string) => void
  onSetWindowQty: (cartLineId: string, q: number) => void
  onRemoveWindow: (cartLineId: string) => void
}) {
  const [pickup, setPickup] = useState(formDefaults.pickupDate)
  const [returnD, setReturnD] = useState(formDefaults.returnDate)
  const hasWindows = windows.length > 0
  const priceOnQuote = vehicle.dailyRate == null || vehicle.dailyRate === 0
  const datesValid = !!pickup && !!returnD && returnD >= pickup

  const commitWindow = () => {
    if (!datesValid) return
    onAdd(pickup, returnD)
    // Reset the form so the next "+ Add window" click writes a NEW
    // cart line instead of merging into the same one.
    setPickup(formDefaults.pickupDate)
    setReturnD(formDefaults.returnDate)
  }

  return (
    <div
      className={`w-[280px] xl:w-auto shrink-0 snap-start bg-white rounded-[16px] overflow-hidden shadow-sm transition-all flex flex-col ${
        hasWindows ? 'border border-[#c39a3f] shadow-[0_0_0_1px_#c39a3f]' : 'border border-[#e4dfd4]'
      }`}
    >
      {/* Image + name link to the public vehicle detail page. Scoped to these
          non-interactive regions only — the Reserve button, date inputs and qty
          steppers below stay fully clickable (the card root is a div, not an
          anchor, so there's no nested-anchor hijacking). */}
      <Link href={`/vehicles/${vehicle.slug}`} className="block" title={`View ${vehicle.name} details`}>
        {vehicle.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={vehicle.photoUrl}
            alt={vehicle.name}
            className="w-full aspect-[16/10] object-cover bg-[#f0eadb]"
            loading="lazy"
          />
        ) : (
          // Intentional brand-dark placeholder — big gold S mark, not a
          // broken-image state.
          <div className="w-full aspect-[16/10] bg-[#0c0c0d] flex items-center justify-center">
            <span className="w-14 h-14 rounded-[14px] bg-[#c39a3f] text-[#0c0c0d] font-black text-[32px] inline-flex items-center justify-center opacity-90" style={{ fontFamily: 'Archivo, sans-serif' }}>S</span>
          </div>
        )}
      </Link>
      <div className="p-2.5 flex flex-col gap-2 flex-1">
        <div className="min-w-0">
          <Link
            href={`/vehicles/${vehicle.slug}`}
            className="font-extrabold text-[16px] leading-[1.2] tracking-tight hover:text-[#a37f2c] transition-colors"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            {vehicle.name}
          </Link>
          {vehicle.subtitle && (
            <div className="text-[12px] text-[#8b857a] mt-0.5 truncate">{vehicle.subtitle}</div>
          )}
          <div className="font-semibold text-[12.5px] text-[#8b857a] mt-1" style={{ fontFamily: 'Archivo, sans-serif' }}>
            {priceOnQuote ? (
              <span className="text-[#a37f2c] font-extrabold">PRICE ON QUOTE</span>
            ) : (
              <>
                <b className="text-[#a37f2c] font-extrabold text-[15px]">{fmtMoney(vehicle.dailyRate!)}</b> /day
              </>
            )}
          </div>
        </div>

        {/* Existing windows for this vehicle — each one its own row
            bound to its own cart line. Editing dates here calls
            setDates(lineId, …); qty stepper + × remove are the per-
            window controls. The row order matches insertion order. */}
        {hasWindows && (
          <div className="flex flex-col gap-2">
            {windows.map((w, idx) => (
              <div
                key={w.cartLineId}
                className="rounded-[8px] border border-[#e4dfd4] bg-[#fbf6ea]/40 p-2 flex flex-col gap-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-[0.08em] text-[#8b857a] font-semibold" style={{ fontFamily: 'Archivo, sans-serif' }}>
                    Window {idx + 1}
                  </span>
                  <button
                    onClick={() => onRemoveWindow(w.cartLineId)}
                    className="text-[#8b857a] hover:text-[#a3431b] text-[14px] leading-none px-1"
                    aria-label={`Remove window ${idx + 1}`}
                    title="Remove this window"
                  >
                    ×
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="flex flex-col">
                    <span className="text-[9px] uppercase tracking-[0.08em] text-[#8b857a] font-semibold mb-0.5" style={{ fontFamily: 'Archivo, sans-serif' }}>Pickup</span>
                    <input
                      type="date"
                      value={w.pickupDate}
                      onChange={(e) => onSetWindowDates(w.cartLineId, e.target.value, w.returnDate)}
                      className="border-[1.5px] border-[#cdc7b9] rounded-md px-1.5 py-1 text-[11px] outline-none focus:border-[#0c0c0d] min-w-0"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-[9px] uppercase tracking-[0.08em] text-[#8b857a] font-semibold mb-0.5" style={{ fontFamily: 'Archivo, sans-serif' }}>Return</span>
                    <input
                      type="date"
                      value={w.returnDate}
                      onChange={(e) => onSetWindowDates(w.cartLineId, w.pickupDate, e.target.value)}
                      min={w.pickupDate || undefined}
                      className="border-[1.5px] border-[#cdc7b9] rounded-md px-1.5 py-1 text-[11px] outline-none focus:border-[#0c0c0d] min-w-0"
                    />
                  </label>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] uppercase tracking-[0.08em] text-[#8b857a] font-semibold" style={{ fontFamily: 'Archivo, sans-serif' }}>Qty</span>
                  <div className="flex items-center border-[1.5px] border-[#c39a3f] rounded-[8px] overflow-hidden h-[28px]">
                    <button onClick={() => onSetWindowQty(w.cartLineId, w.qty - 1)} className="w-[24px] h-full bg-white text-[#a37f2c] text-base font-bold hover:bg-[#fbf6ea]" aria-label="Decrease">−</button>
                    <span className="min-w-[24px] text-center font-extrabold text-[13px]" style={{ fontFamily: 'Archivo, sans-serif' }}>{w.qty}</span>
                    <button onClick={() => onSetWindowQty(w.cartLineId, w.qty + 1)} className="w-[24px] h-full bg-white text-[#a37f2c] text-base font-bold hover:bg-[#fbf6ea]" aria-label="Increase">+</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Next-window form — fresh pickup/return + the "+ Add window"
            (or "+ Reserve" when none yet) button. Both labels commit
            the form via the same handler and reset the inputs. */}
        <div className="mt-auto flex flex-col gap-1.5">
          {hasWindows && (
            <div className="text-[10px] uppercase tracking-[0.08em] text-[#8b857a] font-semibold pt-1 border-t border-[#e4dfd4]" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Next window
            </div>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            <label className="flex flex-col">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[#8b857a] font-semibold mb-0.5" style={{ fontFamily: 'Archivo, sans-serif' }}>Pickup</span>
              <input
                type="date"
                value={pickup}
                onChange={(e) => setPickup(e.target.value)}
                className="border-[1.5px] border-[#cdc7b9] rounded-md px-1.5 py-1.5 text-[11px] outline-none focus:border-[#0c0c0d] min-w-0"
              />
            </label>
            <label className="flex flex-col">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[#8b857a] font-semibold mb-0.5" style={{ fontFamily: 'Archivo, sans-serif' }}>Return</span>
              <input
                type="date"
                value={returnD}
                onChange={(e) => setReturnD(e.target.value)}
                min={pickup || undefined}
                className="border-[1.5px] border-[#cdc7b9] rounded-md px-1.5 py-1.5 text-[11px] outline-none focus:border-[#0c0c0d] min-w-0"
              />
            </label>
          </div>
          <button
            onClick={commitWindow}
            disabled={!datesValid}
            className={
              hasWindows
                ? 'w-full border-[1.5px] border-[#cdc7b9] bg-white text-[#1a1a1c] rounded-[10px] h-[36px] px-3 font-bold text-[12px] tracking-wide hover:border-[#0c0c0d] disabled:opacity-40 disabled:cursor-not-allowed'
                : 'w-full border-[1.5px] border-[#d97706] bg-[#d97706] text-white rounded-[10px] h-[44px] px-3 font-extrabold text-[13.5px] tracking-wide hover:bg-[#e2830d] transition-colors disabled:opacity-40 disabled:bg-[#5a5a5c] disabled:border-[#5a5a5c] disabled:cursor-not-allowed'
            }
            style={{ fontFamily: 'Archivo, sans-serif' }}
            title={hasWindows ? 'Reserve another window of this vehicle' : 'Reserve this vehicle'}
          >
            {hasWindows ? '+ Add window' : 'Reserve'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CartSidebar({
  lines,
  totalUnits,
  totalEstimate,
  hasPriceOnQuote,
  onSetQty,
  onReview,
}: {
  lines: CartLine[]
  totalUnits: number
  totalEstimate: number
  hasPriceOnQuote: boolean
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
          (() => {
            // Same rental predicate as lineEstimate (VEHICLE or EQUIPMENT =
            // rental ×days; everything else = flat one-time purchase). Partition
            // so the client immediately sees what's rented vs. bought.
            const isRentalLine = (l: CartLine) => l.itemKind === 'VEHICLE' || l.type === 'EQUIPMENT'
            const rentalLines = lines.filter(isRentalLine)
            const purchaseLines = lines.filter((l) => !isRentalLine(l))
            const bothGroups = rentalLines.length > 0 && purchaseLines.length > 0
            const groupSubtotal = (g: CartLine[]) => g.reduce((s, l) => s + lineEstimate(l), 0)

            const renderLine = (l: CartLine) => {
              const isRental = isRentalLine(l)
              const days = isRental ? rentalDaysBetween(l.pickupDate, l.returnDate) : 1
              return (
                <div key={l.cartLineId} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-[#191919]">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold leading-tight truncate">{l.name}</div>
                    <div className="text-[11.5px] text-[#a8a294] mt-0.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
                      {l.price === 0
                        ? 'PRICE ON QUOTE'
                        : `${fmtMoney(l.price)}${isRental ? `/d × ${days}d` : ' ea'}`}
                    </div>
                  </div>
                  <div className="flex items-center border border-[#2e2e30] rounded-lg overflow-hidden h-[30px]">
                    <button onClick={() => onSetQty(l.cartLineId, l.qty - 1)} className="w-7 h-full bg-[#171717] text-[#c39a3f] text-base font-bold hover:bg-[#222]">−</button>
                    <span className="min-w-[26px] text-center font-bold text-[13px]" style={{ fontFamily: 'Archivo, sans-serif' }}>{l.qty}</span>
                    <button onClick={() => onSetQty(l.cartLineId, l.qty + 1)} className="w-7 h-full bg-[#171717] text-[#c39a3f] text-base font-bold hover:bg-[#222]">+</button>
                  </div>
                  <div className="font-bold text-[13px] min-w-[54px] text-right" style={{ fontFamily: 'Archivo, sans-serif' }}>
                    {fmtTotal(lineEstimate(l))}
                  </div>
                </div>
              )
            }

            const group = (label: string, hint: string, g: CartLine[]) => (
              <div>
                <div className="flex items-baseline justify-between px-3 pt-2 pb-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#8b857a]" style={{ fontFamily: 'Archivo, sans-serif' }}>{label}</span>
                  <span className="text-[10px] text-[#6f6a60]">{hint}</span>
                </div>
                {g.map(renderLine)}
                {/* Per-group subtotal only when BOTH groups exist — with a single
                    kind it would just duplicate the EST. TOTAL below. */}
                {bothGroups && (
                  <div className="flex justify-between px-3 py-1.5 mt-0.5 border-t border-[#242427] text-[12px]">
                    <span className="text-[#a8a294] font-semibold" style={{ fontFamily: 'Archivo, sans-serif' }}>{label} subtotal</span>
                    <span className="font-bold text-[#e8e3d7]" style={{ fontFamily: 'Archivo, sans-serif' }}>{fmtTotal(groupSubtotal(g))}</span>
                  </div>
                )}
              </div>
            )

            return (
              <>
                {rentalLines.length > 0 && group('Rental', 'per day × days', rentalLines)}
                {purchaseLines.length > 0 && (
                  <div className={rentalLines.length > 0 ? 'mt-2 pt-1.5 border-t-2 border-[#2e2e30]' : ''}>
                    {group('Expendables · purchased', 'one-time', purchaseLines)}
                  </div>
                )}
              </>
            )
          })()
        )}
      </div>
      <div className="px-5 py-5 border-t border-[#242427] bg-[#0a0a0b]">
        <div className="flex justify-between items-baseline mt-2 mb-2">
          <span className="font-bold text-sm tracking-wider uppercase" style={{ fontFamily: 'Archivo, sans-serif' }}>Est. total</span>
          <span className="font-black text-2xl text-[#c39a3f] tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>{fmtTotal(totalEstimate)}</span>
        </div>
        <div className="text-[11px] text-[#8b857a] leading-relaxed mb-3.5">
          {hasPriceOnQuote ? 'Some lines priced on quote and not included. ' : ''}
          Estimate at standard rates across your selected windows. Final pricing, taxes, delivery and multi-day discounts confirmed in your quote.
        </div>
        <button
          onClick={onReview}
          disabled={lines.length === 0}
          className="w-full bg-[#d97706] text-white rounded-xl py-4 text-sm font-extrabold tracking-wide hover:bg-[#e2830d] disabled:bg-[#2a2a2c] disabled:text-[#5a5a5c] disabled:cursor-not-allowed transition-colors"
          style={{ fontFamily: 'Archivo, sans-serif' }}
        >
          Review &amp; submit →
        </button>
      </div>
    </div>
  )
}

// CategorySection — one block per cart category in the Review panel.
// Header shows category name + a "Window" pair of inputs that bulk-set
// pickup/return on every line in the category that hasn't been
// individually touched. The header inputs lazy-display the most common
// (pickup,return) tuple among current lines (or the first line's
// window if mixed). The "x of y manually edited" tag tells the agent
// how many lines will skip the next cascade.
function CategorySection({
  category,
  lines,
  touchedLineIds,
  onSetQty,
  onRemove,
  onSetLineDates,
  onCascadeCategoryDates,
}: {
  category: string
  lines: CartLine[]
  touchedLineIds: Set<string>
  onSetQty: (cartLineId: string, q: number) => void
  onRemove: (cartLineId: string) => void
  onSetLineDates: (cartLineId: string, pickup: string, returnD: string) => void
  onCascadeCategoryDates: (pickup: string, returnD: string) => void
}) {
  // Default = most common (pickup,return) tuple in the category, else
  // first line's window.
  const counts = new Map<string, { p: string; r: string; n: number }>()
  for (const l of lines) {
    const k = `${l.pickupDate}__${l.returnDate}`
    const cur = counts.get(k) ?? { p: l.pickupDate, r: l.returnDate, n: 0 }
    cur.n += 1
    counts.set(k, cur)
  }
  const top = [...counts.values()].sort((a, b) => b.n - a.n)[0]
  const defaultPickup = top?.p ?? lines[0]?.pickupDate ?? ''
  const defaultReturn = top?.r ?? lines[0]?.returnDate ?? ''
  const mixed = counts.size > 1
  const touchedInCategory = lines.filter((l) => touchedLineIds.has(l.cartLineId)).length

  return (
    <section className="mb-6">
      <div className="bg-[#fbf6ea] border border-[#e4dfd4] rounded-lg px-3.5 py-3 mb-2.5">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <div className="font-extrabold text-[15px] tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
            {category}
            <span className="ml-2 text-[11px] font-semibold text-[#8b857a] tracking-wider uppercase">
              {lines.length} {lines.length === 1 ? 'line' : 'lines'}
            </span>
          </div>
          {touchedInCategory > 0 && (
            <div className="text-[10.5px] text-[#8b857a]">
              {touchedInCategory} manually edited
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col">
            <span className="text-[10px] uppercase tracking-[0.08em] text-[#8b857a] font-semibold mb-0.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Pickup {mixed && <em className="not-italic text-[#a37f2c]">(varies)</em>}
            </span>
            <input
              type="date"
              defaultValue={defaultPickup}
              onChange={(e) => {
                const newPickup = e.target.value
                if (!newPickup) return
                onCascadeCategoryDates(newPickup, defaultReturn)
              }}
              className="border-[1.5px] border-[#cdc7b9] bg-white rounded-md px-2 py-1.5 text-[12.5px] outline-none focus:border-[#0c0c0d] min-w-0"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-[10px] uppercase tracking-[0.08em] text-[#8b857a] font-semibold mb-0.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Return {mixed && <em className="not-italic text-[#a37f2c]">(varies)</em>}
            </span>
            <input
              type="date"
              defaultValue={defaultReturn}
              min={defaultPickup || undefined}
              onChange={(e) => {
                const newReturn = e.target.value
                if (!newReturn) return
                onCascadeCategoryDates(defaultPickup, newReturn)
              }}
              className="border-[1.5px] border-[#cdc7b9] bg-white rounded-md px-2 py-1.5 text-[12.5px] outline-none focus:border-[#0c0c0d] min-w-0"
            />
          </label>
        </div>
        <div className="text-[10.5px] text-[#8b857a] mt-1.5 leading-snug">
          Cascades to lines below. Lines you&rsquo;ve edited individually keep their own dates.
        </div>
      </div>
      {lines.map((l) => (
        <ReviewRow
          key={l.cartLineId}
          line={l}
          touched={touchedLineIds.has(l.cartLineId)}
          onSetQty={(q) => onSetQty(l.cartLineId, q)}
          onSetDates={(p, r) => onSetLineDates(l.cartLineId, p, r)}
          onRemove={() => onRemove(l.cartLineId)}
        />
      ))}
    </section>
  )
}

function ReviewRow({
  line,
  touched,
  onSetQty,
  onSetDates,
  onRemove,
}: {
  line: CartLine
  touched: boolean
  onSetQty: (q: number) => void
  onSetDates: (pickup: string, returnD: string) => void
  onRemove: () => void
}) {
  const isRental = line.itemKind === 'VEHICLE' || line.type === 'EQUIPMENT'
  const days = isRental ? rentalDaysBetween(line.pickupDate, line.returnDate) : 1
  return (
    <div className="py-3 border-b border-[#e4dfd4]">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[15px] flex items-center gap-1.5">
            <span className="truncate">{line.name}</span>
            {touched && (
              <span className="flex-none text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#a37f2c] bg-[#f6efdc] rounded px-1.5 py-px" title="Manually edited — won't cascade with category">
                Custom
              </span>
            )}
          </div>
          <div className="text-[12px] text-[#8b857a] mt-0.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
            {line.price === 0
              ? 'PRICE ON QUOTE'
              : `${fmtMoney(line.price)}${isRental ? `/d × ${days}d` : ' ea'}`}
          </div>
        </div>
        <div className="flex items-center border-[1.5px] border-[#cdc7b9] rounded-lg overflow-hidden h-[32px] flex-none">
          <button onClick={() => onSetQty(line.qty - 1)} className="w-[28px] h-full bg-white text-[#a37f2c] text-[16px] font-bold">−</button>
          <span className="min-w-[24px] text-center font-extrabold text-sm" style={{ fontFamily: 'Archivo, sans-serif' }}>{line.qty}</span>
          <button onClick={() => onSetQty(line.qty + 1)} className="w-[28px] h-full bg-white text-[#a37f2c] text-[16px] font-bold">+</button>
        </div>
        <div className="font-extrabold text-sm min-w-[58px] text-right flex-none" style={{ fontFamily: 'Archivo, sans-serif' }}>
          {fmtTotal(lineEstimate(line))}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2 pl-0.5">
        <input
          type="date"
          value={line.pickupDate}
          onChange={(e) => e.target.value && onSetDates(e.target.value, line.returnDate)}
          className="border-[1.5px] border-[#cdc7b9] bg-white rounded-md px-1.5 py-1 text-[11.5px] outline-none focus:border-[#0c0c0d] min-w-0 flex-1"
          aria-label="Pickup date"
        />
        <span className="text-[#8b857a] text-[11px]">→</span>
        <input
          type="date"
          value={line.returnDate}
          min={line.pickupDate}
          onChange={(e) => e.target.value && onSetDates(line.pickupDate, e.target.value)}
          className="border-[1.5px] border-[#cdc7b9] bg-white rounded-md px-1.5 py-1 text-[11.5px] outline-none focus:border-[#0c0c0d] min-w-0 flex-1"
          aria-label="Return date"
        />
        <button
          type="button"
          onClick={onRemove}
          className="text-[11px] text-[#8b857a] underline px-1 hover:text-[#0c0c0d] flex-none"
        >
          remove
        </button>
      </div>
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
      className={`fixed z-[60] bg-[#f4f1ea] flex flex-col shadow-[0_30px_70px_rgba(12,12,13,0.28)] transition-transform duration-300 ease-out
        inset-x-0 bottom-0 top-[8vh] rounded-t-[20px]
        sm:inset-x-auto sm:top-0 sm:right-0 sm:bottom-0 sm:w-[560px] sm:rounded-none
        ${show ? 'translate-y-0 sm:translate-x-0' : 'translate-y-full sm:translate-y-0 sm:translate-x-full'}`}
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
