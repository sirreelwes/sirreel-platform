'use client'

/**
 * SubRentalModal — Phase 1 of the sub-rentals feature.
 *
 * Internal-only modal that opens off an order-detail EQUIPMENT or
 * EXPENDABLE line. Lists existing sub-rentals on the line + a form
 * to mint a new one. Vendor picker = existing vendors + inline
 * quick-create. Quantity capped at line.quantity (partial fulfillment
 * supported). Receive method = PICKUP or DELIVERY (Phase 2 logistics).
 *
 * Pricing posture: caller enters VENDOR cost only. Client price is
 * derived server-side from the order line's rate × quantity — the
 * client already saw that number on the quote and we don't accept a
 * second copy from this UI.
 *
 * Auth: API enforces Permissions.subRentals on POST/PATCH/DELETE. The
 * order-detail page should still gate the "Sub-rent…" button on the
 * same perm for UX hygiene.
 */

import { useCallback, useEffect, useState } from 'react'

type SubRentalStatus =
  | 'REQUESTED' | 'CONFIRMED' | 'PICKED_UP' | 'ON_RENT' | 'RETURNED' | 'CANCELLED'

type ReceiveMethod = 'PICKUP' | 'DELIVERY'

interface Vendor { id: string; name: string }

export interface SubRentalRow {
  id: string
  status: SubRentalStatus
  receiveMethod: ReceiveMethod | null
  itemDescription: string
  quantity: number
  startDate: string | null
  endDate: string | null
  vendorTotal: string | null
  clientTotal: string | null
  poNumber: string | null
  vendor: { id: string; name: string }
}

export interface SubRentalLineContext {
  orderId: string
  orderLineItemId: string
  /** OrderLineItem.description — used to seed the modal's itemDescription
   *  field on first open. The picker still lets the rep edit. */
  description: string
  /** OrderLineItem.quantity — the cap on quantity entry. */
  quantity: number
  /** Client-side rate per day; shown as the derived client price column
   *  for transparency. NOT editable. */
  rate: number
  /** Default pickup/return dates pre-fill from the line's window. */
  pickupDate: string | null
  returnDate: string | null
}

const STATUS_COLORS: Record<SubRentalStatus, string> = {
  REQUESTED: 'bg-zinc-700/40 text-zinc-300',
  CONFIRMED: 'bg-blue-900/50 text-blue-300',
  PICKED_UP: 'bg-indigo-900/50 text-indigo-300',
  ON_RENT:   'bg-amber-900/50 text-amber-300',
  RETURNED:  'bg-emerald-900/50 text-emerald-300',
  CANCELLED: 'bg-zinc-900/50 text-zinc-500 line-through',
}

function fmtMoney(n: number | string | null | undefined): string {
  if (n == null) return '—'
  const num = typeof n === 'string' ? Number(n) : n
  if (!Number.isFinite(num)) return '—'
  return `$${num.toFixed(2)}`
}

function toISODate(d: string | null | undefined): string {
  if (!d) return ''
  return d.slice(0, 10)
}

export function SubRentalModal({
  line,
  onClose,
  onChanged,
}: {
  line: SubRentalLineContext
  onClose: () => void
  onChanged: () => void
}) {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [rentals, setRentals] = useState<SubRentalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // New-rental form state
  const [vendorId, setVendorId] = useState<string>('')
  const [newVendorName, setNewVendorName] = useState<string>('')
  const [creatingVendor, setCreatingVendor] = useState(false)
  const [qty, setQty] = useState<string>(String(line.quantity))
  const [receiveMethod, setReceiveMethod] = useState<ReceiveMethod>('PICKUP')
  const [vendorDailyRate, setVendorDailyRate] = useState<string>('')
  const [vendorWeeklyRate, setVendorWeeklyRate] = useState<string>('')
  const [vendorTotal, setVendorTotal] = useState<string>('')
  const [startDate, setStartDate] = useState<string>(toISODate(line.pickupDate))
  const [endDate, setEndDate] = useState<string>(toISODate(line.returnDate))
  const [poNumber, setPoNumber] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [itemDescription, setItemDescription] = useState<string>(line.description)
  const [submitting, setSubmitting] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [vRes, rRes] = await Promise.all([
        fetch('/api/vendors', { cache: 'no-store' }),
        fetch(`/api/sub-rentals?orderLineItemId=${encodeURIComponent(line.orderLineItemId)}`, { cache: 'no-store' }),
      ])
      const vJson = await vRes.json().catch(() => ({}))
      const rJson = await rRes.json().catch(() => ({}))
      setVendors(vJson.vendors ?? [])
      setRentals(rJson.subRentals ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load')
    } finally {
      setLoading(false)
    }
  }, [line.orderLineItemId])

  useEffect(() => {
    void reload()
  }, [reload])

  const onQuickCreateVendor = async () => {
    const name = newVendorName.trim()
    if (!name) return
    setCreatingVendor(true)
    try {
      const r = await fetch('/api/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const j = await r.json()
      if (!r.ok) {
        // 409 returns the existing vendorId — auto-select it.
        if (r.status === 409 && j?.vendorId) {
          setVendorId(j.vendorId)
          setNewVendorName('')
          await reload()
          return
        }
        setError(j?.error || `vendor create failed (${r.status})`)
        return
      }
      setVendorId(j.id)
      setNewVendorName('')
      await reload()
    } finally {
      setCreatingVendor(false)
    }
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!vendorId) {
      setError('Pick or create a vendor first.')
      return
    }
    const qtyNum = Math.max(1, Math.floor(Number(qty) || 0))
    if (qtyNum > line.quantity) {
      setError(`Quantity ${qtyNum} exceeds the line quantity (${line.quantity}).`)
      return
    }
    setSubmitting(true)
    try {
      const body = {
        orderId: line.orderId,
        orderLineItemId: line.orderLineItemId,
        vendorId,
        receiveMethod,
        itemDescription: itemDescription.trim() || line.description,
        quantity: qtyNum,
        startDate: startDate || null,
        endDate: endDate || null,
        vendorDailyRate: vendorDailyRate ? Number(vendorDailyRate) : null,
        vendorWeeklyRate: vendorWeeklyRate ? Number(vendorWeeklyRate) : null,
        vendorTotal: vendorTotal ? Number(vendorTotal) : null,
        poNumber: poNumber.trim() || null,
        notes: notes.trim() || null,
      }
      const r = await fetch('/api/sub-rentals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) {
        setError(j?.error || `create failed (${r.status})`)
        return
      }
      // Reset form for the rare case of a second sub-rental on the same line.
      setQty(String(line.quantity))
      setVendorDailyRate(''); setVendorWeeklyRate(''); setVendorTotal('')
      setPoNumber(''); setNotes('')
      await reload()
      onChanged()
    } finally {
      setSubmitting(false)
    }
  }

  const onCancel = async (id: string) => {
    if (!confirm('Cancel this sub-rental?')) return
    const r = await fetch(`/api/sub-rentals/${id}`, { method: 'DELETE' })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      setError(j?.error || `cancel failed (${r.status})`)
      return
    }
    await reload()
    onChanged()
  }

  const margin = (sr: SubRentalRow): number | null => {
    if (sr.clientTotal == null || sr.vendorTotal == null) return null
    return Number(sr.clientTotal) - Number(sr.vendorTotal)
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-xl w-[680px] max-w-full my-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              Sub-rental — INTERNAL ONLY (never on client docs)
            </div>
            <h2 className="text-lg font-semibold text-white mt-0.5 truncate">{line.description}</h2>
            <div className="text-xs text-zinc-400 mt-0.5">
              line qty {line.quantity} · client rate {fmtMoney(line.rate)}/day
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-3 text-xs text-rose-300 bg-rose-950/50 border border-rose-800 rounded px-3 py-2">
            {error}
          </div>
        )}

        {/* Existing sub-rentals on this line */}
        <div className="px-5 py-4 border-b border-zinc-800">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">
            On this line ({rentals.length})
          </div>
          {loading ? (
            <div className="text-xs text-zinc-500">Loading…</div>
          ) : rentals.length === 0 ? (
            <div className="text-xs text-zinc-500">No sub-rentals on this line yet.</div>
          ) : (
            <div className="space-y-2">
              {rentals.map((sr) => {
                const m = margin(sr)
                return (
                  <div key={sr.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${STATUS_COLORS[sr.status]}`}>
                            {sr.status.replace('_', ' ')}
                          </span>
                          <span className="text-sm font-semibold text-white">{sr.vendor.name}</span>
                          <span className="text-[11px] text-zinc-400">qty {sr.quantity}</span>
                          {sr.receiveMethod && (
                            <span className="text-[11px] text-zinc-400">· {sr.receiveMethod.toLowerCase()}</span>
                          )}
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-1">
                          {sr.startDate ? `pickup ${toISODate(sr.startDate)}` : 'pickup TBD'}
                          {' → '}
                          {sr.endDate ? `return-by ${toISODate(sr.endDate)}` : 'return TBD'}
                          {sr.poNumber ? ` · PO ${sr.poNumber}` : ''}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] uppercase tracking-wide text-zinc-500">vendor / client</div>
                        <div className="text-xs text-zinc-300 font-mono">
                          {fmtMoney(sr.vendorTotal)} / {fmtMoney(sr.clientTotal)}
                        </div>
                        {m != null && (
                          <div className={`text-[10px] font-mono ${m >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {m >= 0 ? '+' : ''}{fmtMoney(m)} margin
                          </div>
                        )}
                      </div>
                    </div>
                    {sr.status !== 'CANCELLED' && (
                      <div className="mt-2 flex justify-end">
                        <button
                          onClick={() => onCancel(sr.id)}
                          className="text-[11px] text-rose-400 hover:text-rose-300"
                        >
                          Cancel sub-rental
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* New sub-rental form */}
        <form onSubmit={onSubmit} className="px-5 py-4 space-y-3">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
            New sub-rental
          </div>

          {/* Vendor — picker + quick create */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
              Vendor
            </label>
            <div className="flex gap-2">
              <select
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                className="flex-1 bg-zinc-900 border border-zinc-700 text-white text-sm rounded px-2 py-1.5"
              >
                <option value="">— select a vendor —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                placeholder="or type a new vendor name…"
                value={newVendorName}
                onChange={(e) => setNewVendorName(e.target.value)}
                className="flex-1 bg-zinc-900 border border-zinc-700 text-white text-sm rounded px-2 py-1.5 placeholder-zinc-600"
              />
              <button
                type="button"
                onClick={onQuickCreateVendor}
                disabled={!newVendorName.trim() || creatingVendor}
                className="px-3 text-xs font-semibold border border-zinc-700 text-zinc-200 hover:border-amber-500 hover:text-amber-300 rounded disabled:opacity-40"
              >
                {creatingVendor ? 'Creating…' : '+ Add vendor'}
              </button>
            </div>
          </div>

          {/* Item description (defaults to the line description) */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
              Item description (vendor-side)
            </label>
            <input
              type="text"
              value={itemDescription}
              onChange={(e) => setItemDescription(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded px-2 py-1.5"
            />
          </div>

          {/* Qty + receive method */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                Quantity (≤ {line.quantity})
              </label>
              <input
                type="number"
                min={1}
                max={line.quantity}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded px-2 py-1.5"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                Receive method
              </label>
              <select
                value={receiveMethod}
                onChange={(e) => setReceiveMethod(e.target.value as ReceiveMethod)}
                className="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded px-2 py-1.5"
              >
                <option value="PICKUP">Pickup from vendor</option>
                <option value="DELIVERY">Vendor delivers to SirReel</option>
              </select>
            </div>
          </div>

          {/* Vendor cost */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
              Vendor cost (SirReel pays)
            </label>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="number"
                step="0.01"
                placeholder="daily $"
                value={vendorDailyRate}
                onChange={(e) => setVendorDailyRate(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 text-white text-sm rounded px-2 py-1.5 font-mono"
              />
              <input
                type="number"
                step="0.01"
                placeholder="weekly $"
                value={vendorWeeklyRate}
                onChange={(e) => setVendorWeeklyRate(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 text-white text-sm rounded px-2 py-1.5 font-mono"
              />
              <input
                type="number"
                step="0.01"
                placeholder="total $"
                value={vendorTotal}
                onChange={(e) => setVendorTotal(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 text-white text-sm rounded px-2 py-1.5 font-mono"
              />
            </div>
            <div className="mt-1 text-[10px] text-zinc-500">
              Client price is the line rate ({fmtMoney(line.rate)}/day × qty) — derived, not entered.
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                Pickup from vendor
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded px-2 py-1.5"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                Return to vendor by
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded px-2 py-1.5"
              />
            </div>
          </div>

          {/* PO + notes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                PO #
              </label>
              <input
                type="text"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded px-2 py-1.5"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                Notes
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded px-2 py-1.5"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={submitting || !vendorId}
              className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded disabled:opacity-40"
            >
              {submitting ? 'Creating…' : 'Create sub-rental'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
