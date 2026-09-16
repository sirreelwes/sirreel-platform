'use client'

/**
 * "Driver add-ons" — the last-minute extras a driver asks for while fleet
 * or the warehouse checks the order out (Wes 2026-09-16: "very easy and
 * user-friendly … collapsed into the original order with notes on the fact
 * that the driver requested these things").
 *
 * Built for a phone at the truck: one tap on a chip adds the usual asks
 * (straps, pads, a dolly), +/− sets the count, search covers anything else,
 * and one button puts it all on the order. Catalog picks price themselves
 * off the client's rates; something typed free-hand lands "needs a price"
 * for the agent — never a silent $0 (lib/orders/checkoutAddOns).
 *
 * Used on the dark handover screen and the light check-out sheet, hence
 * `tone`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Minus, PackagePlus, Plus, Search, X } from 'lucide-react'
import { WALKAROUND_CREW, WAREHOUSE_CREW } from '@/lib/fleet/walkaroundCrew'

interface Quick {
  inventoryItemId: string
  label: string
  description: string
}
interface AddedLine {
  id: string
  description: string
  quantity: number
  note: string | null
  addedAt: string
  addedBy: string | null
  unpriced: boolean
}
interface Pick {
  key: string
  inventoryItemId: string | null
  description: string
  label: string
  quantity: number
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export function CheckoutAddOnsCard({
  orderId,
  orderNumber,
  driverName = '',
  crewName = '',
  tone = 'dark',
}: {
  orderId: string
  orderNumber?: string | null
  /** Prefill — the driver on this handover, when known. */
  driverName?: string
  /** Prefill — whoever is filing the sheet, when known. */
  crewName?: string
  tone?: 'dark' | 'light'
}) {
  const dark = tone === 'dark'
  // Everyone who checks things out, the likelier side first: fleet on the
  // handover screen, the warehouse on the check-out sheet.
  const crewNames = dark ? [...WALKAROUND_CREW, ...WAREHOUSE_CREW] : [...WAREHOUSE_CREW, ...WALKAROUND_CREW]
  const c = dark
    ? {
        card: 'border-zinc-700 bg-zinc-800',
        title: 'text-white',
        sub: 'text-zinc-400',
        chip: 'border-zinc-600 bg-zinc-900 text-zinc-100 active:bg-zinc-700',
        chipOn: 'border-amber-500 bg-amber-950/40 text-amber-100',
        input: 'bg-zinc-900 border-zinc-600 text-white placeholder:text-zinc-500',
        row: 'border-zinc-700 bg-zinc-900/60',
        muted: 'text-zinc-500',
        menu: 'border-zinc-600 bg-zinc-900',
        menuItem: 'text-zinc-100 active:bg-zinc-800',
        good: 'text-emerald-400',
        warn: 'text-amber-400',
      }
    : {
        card: 'border-lt-hairline bg-lt-card',
        title: 'text-lt-fg',
        sub: 'text-lt-fg2',
        chip: 'border-lt-hairline bg-lt-inner text-lt-fg hover:border-lt-fg3',
        chipOn: 'border-amber-600 bg-chip-warn-bg text-lt-fg',
        input: 'bg-lt-inner border-lt-hairline text-lt-fg placeholder:text-lt-fg3',
        row: 'border-lt-hairline bg-lt-inner',
        muted: 'text-lt-fg3',
        menu: 'border-lt-hairline bg-lt-card',
        menuItem: 'text-lt-fg hover:bg-lt-inner',
        good: 'text-chip-good-fg',
        warn: 'text-chip-warn-fg',
      }

  const [open, setOpen] = useState(false)
  const [quick, setQuick] = useState<Quick[]>([])
  const [added, setAdded] = useState<AddedLine[]>([])
  const [picks, setPicks] = useState<Pick[]>([])
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Array<{ id: string; code: string; description: string }>>([])
  const [driver, setDriver] = useState(driverName)
  const [crew, setCrew] = useState(crewName)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch(`/api/orders/${orderId}/checkout-addons`)
    const j = await r.json().catch(() => ({}))
    if (r.ok) {
      setQuick(j.quick ?? [])
      setAdded(j.added ?? [])
    }
  }, [orderId])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => setDriver((d) => d || driverName), [driverName])
  useEffect(() => setCrew((v) => v || crewName), [crewName])

  // Catalog search for anything that isn't a chip.
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setHits([])
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      const r = await fetch(`/api/inventory/search?q=${encodeURIComponent(term)}&limit=6`)
      const j = await r.json().catch(() => ({}))
      if (!cancelled) setHits(j.items ?? [])
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q])

  const bump = (p: Omit<Pick, 'quantity'>, by = 1) =>
    setPicks((prev) => {
      const i = prev.findIndex((x) => x.key === p.key)
      if (i < 0) return by > 0 ? [...prev, { ...p, quantity: by }] : prev
      const next = [...prev]
      const qty = next[i].quantity + by
      if (qty <= 0) next.splice(i, 1)
      else next[i] = { ...next[i], quantity: qty }
      return next
    })
  const qtyOf = (key: string) => picks.find((p) => p.key === key)?.quantity ?? 0
  const total = useMemo(() => picks.reduce((n, p) => n + p.quantity, 0), [picks])

  async function submit() {
    setBusy(true)
    setErr(null)
    setDone(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/checkout-addons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: picks.map((p) => ({ inventoryItemId: p.inventoryItemId, description: p.description, quantity: p.quantity })),
          driverName: driver,
          addedBy: crew,
          note,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not add those.')
      setAdded(j.lines ?? [])
      setPicks([])
      setNote('')
      setQ('')
      setDone(
        `Added to ${j.orderNumber}.${j.unpriced ? ` ${j.unpriced} need${j.unpriced === 1 ? 's' : ''} a price from the agent.` : ''}`,
      )
      setOpen(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add those.')
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = total > 0 && crew.trim().length > 0 && !busy

  return (
    <section className={`mb-5 rounded-xl border p-3.5 ${c.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-base font-semibold ${c.title}`}>Driver add-ons</div>
          <p className={`text-[13px] ${c.sub}`}>
            Extra gear the driver asks for goes on {orderNumber ? `order ${orderNumber}` : 'the order'}, noted as their request.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 min-h-[44px] rounded-lg bg-amber-600 px-3 text-sm font-semibold text-white active:bg-amber-500 inline-flex items-center gap-1.5"
          >
            <PackagePlus size={16} aria-hidden /> Add
          </button>
        )}
      </div>

      {done && <p className={`mt-2 text-[13px] font-medium ${c.good}`}>{done}</p>}

      {open && (
        <div className="mt-3 space-y-3">
          {/* One tap for the usual asks */}
          {quick.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {quick.map((item) => {
                const key = `inv:${item.inventoryItemId}`
                const n = qtyOf(key)
                const base = { key, inventoryItemId: item.inventoryItemId, description: item.description, label: item.label }
                return (
                  <div key={key} className={`rounded-lg border ${n ? c.chipOn : c.chip}`}>
                    <button type="button" onClick={() => bump(base)} className="w-full min-h-[48px] px-2.5 text-left text-[14px] font-medium">
                      {item.label}
                      {n > 0 && <span className="ml-1 font-bold">× {n}</span>}
                    </button>
                    {n > 0 && (
                      <div className="flex border-t border-inherit">
                        <button type="button" onClick={() => bump(base, -1)} className="flex-1 min-h-[40px] inline-flex items-center justify-center" aria-label={`One fewer ${item.label}`}>
                          <Minus size={16} aria-hidden />
                        </button>
                        <button type="button" onClick={() => bump(base, 1)} className="flex-1 min-h-[40px] inline-flex items-center justify-center" aria-label={`One more ${item.label}`}>
                          <Plus size={16} aria-hidden />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Anything else */}
          <div className="relative">
            <Search size={15} aria-hidden className={`absolute left-3 top-1/2 -translate-y-1/2 ${c.muted}`} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Something else…"
              className={`w-full rounded-lg border pl-9 pr-3 py-3 text-base ${c.input}`}
            />
            {q.trim().length >= 2 && (
              <div className={`absolute z-20 left-0 right-0 mt-1 rounded-lg border shadow-lg max-h-64 overflow-y-auto ${c.menu}`}>
                {hits.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => {
                      bump({ key: `inv:${h.id}`, inventoryItemId: h.id, description: h.description, label: h.description })
                      setQ('')
                    }}
                    className={`block w-full text-left px-3 py-2.5 text-[14px] ${c.menuItem}`}
                  >
                    {h.description}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const text = q.trim()
                    bump({ key: `text:${text.toLowerCase()}`, inventoryItemId: null, description: text, label: text })
                    setQ('')
                  }}
                  className={`block w-full text-left px-3 py-2.5 text-[13px] ${c.menuItem}`}
                >
                  Add &ldquo;{q.trim()}&rdquo; as typed <span className={c.warn}>· the agent prices it</span>
                </button>
              </div>
            )}
          </div>

          {/* What's going on (search picks and typed rows — chips show their own count) */}
          {picks.filter((p) => !quick.some((qq) => `inv:${qq.inventoryItemId}` === p.key)).map((p) => (
            <div key={p.key} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${c.row}`}>
              <div className="min-w-0 flex-1">
                <div className={`text-[14px] font-medium truncate ${c.title}`}>{p.label}</div>
                {!p.inventoryItemId && <div className={`text-[12px] ${c.warn}`}>Not a catalog item — the agent prices it</div>}
              </div>
              <button type="button" onClick={() => bump(p, -1)} className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center" aria-label="One fewer">
                <Minus size={16} aria-hidden />
              </button>
              <span className={`w-6 text-center font-bold ${c.title}`}>{p.quantity}</span>
              <button type="button" onClick={() => bump(p, 1)} className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center" aria-label="One more">
                <Plus size={16} aria-hidden />
              </button>
            </div>
          ))}

          <label className="block">
            <span className={`mb-1 block text-[13px] ${c.sub}`}>Driver who asked</span>
            <input value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="Driver's name" className={`w-full rounded-lg border px-3 py-3 text-base ${c.input}`} />
          </label>

          <div>
            <span className={`mb-1 block text-[13px] ${c.sub}`}>Who&rsquo;s adding it?</span>
            <div className="flex flex-wrap gap-2">
              {crewNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setCrew(name)}
                  className={`min-h-[44px] rounded-lg border px-3 text-[14px] font-medium inline-flex items-center gap-1 ${crew === name ? c.chipOn : c.chip}`}
                >
                  {crew === name && <Check size={14} aria-hidden />} {name}
                </button>
              ))}
              <input
                value={crewNames.includes(crew) ? '' : crew}
                onChange={(e) => setCrew(e.target.value)}
                placeholder="Someone else"
                className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-base ${c.input}`}
              />
            </div>
          </div>

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional) — e.g. load was bigger than planned"
            className={`w-full rounded-lg border px-3 py-3 text-base ${c.input}`}
          />

          {err && <p className="rounded-lg bg-red-950/40 border border-red-900 px-3 py-2 text-sm text-red-300">{err}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              className="flex-1 min-h-[52px] rounded-lg bg-amber-600 text-base font-semibold text-white active:bg-amber-500 disabled:opacity-40"
            >
              {busy ? 'Adding…' : total ? `Add ${total} to the order` : 'Pick what they need'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setPicks([])
                setErr(null)
              }}
              className={`min-h-[52px] min-w-[52px] rounded-lg border inline-flex items-center justify-center ${c.chip}`}
              aria-label="Cancel"
            >
              <X size={18} aria-hidden />
            </button>
          </div>
        </div>
      )}

      {added.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className={`text-[12px] font-semibold uppercase tracking-wide ${c.muted}`}>Already added at check-out</div>
          {added.map((l) => (
            <div key={l.id} className={`rounded-lg border px-3 py-2 ${c.row}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className={`text-[14px] font-medium ${c.title}`}>
                  {l.quantity} × {l.description}
                </span>
                <span className={`text-[12px] ${l.unpriced ? c.warn : c.good}`}>{l.unpriced ? 'Needs a price' : 'Priced'}</span>
              </div>
              <div className={`text-[12px] ${c.muted}`}>
                {l.addedBy ? `${l.addedBy} · ` : ''}
                {fmtWhen(l.addedAt)}
                {l.note ? ` · ${l.note}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
