'use client'

/**
 * KitPiecesEditor — the "Included accessories" section of the inventory
 * drawer.
 *
 * A kit piece is another catalog item that goes out WITH this one
 * whether or not the client asked for it: the 6-bank charger and spare
 * batteries that ship with every walkie order. The quantity is a ratio
 * off whatever quantity gets rented, so the editor is mostly about
 * getting that ratio right — hence the live preview, which runs the
 * same resolveKitQuantity() the server uses at quote time.
 *
 * Saved by the drawer's Save button (imperative handle), not its own,
 * so one click commits the item and its kit together.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { resolveKitQuantity, describeKitRatio } from '@/lib/inventory/kitMath'

interface SearchResult {
  id: string
  code: string
  description: string | null
  dailyRate: string
}

interface Row {
  pieceItemId: string
  code: string
  name: string
  dailyRate: number
  qtyPer: string
  perUnits: string
  rounding: 'CEIL' | 'FLOOR'
  minQty: string
  billing: 'FREE' | 'CHARGED'
  clientVisible: boolean
  suppressIfOrdered: boolean
}

export interface KitPiecesHandle {
  /** Persist the kit. Throws on failure so the drawer can show the error. */
  save: () => Promise<void>
}

const field =
  'w-full bg-lt-card border border-lt-hairline rounded-lg px-2 py-1.5 text-sm text-lt-fg focus:outline-none focus:border-amber-500'
const label = 'block text-[11px] font-semibold text-lt-fg2 uppercase tracking-wider mb-1'

export const KitPiecesEditor = forwardRef<KitPiecesHandle, { itemId: string; itemName: string }>(
  function KitPiecesEditor({ itemId, itemName }, ref) {
    const [rows, setRows] = useState<Row[]>([])
    const [loading, setLoading] = useState(true)
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<SearchResult[]>([])
    const [searching, setSearching] = useState(false)
    // Preview quantity — "if someone rents this many, what ships?"
    const [sampleQty, setSampleQty] = useState('12')
    const dirty = useRef(false)

    useEffect(() => {
      let cancelled = false
      setLoading(true)
      dirty.current = false
      fetch(`/api/inventory/items/${itemId}/kit-pieces`)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return
          const list = Array.isArray(d?.kitPieces) ? d.kitPieces : []
          setRows(
            list.map((k: Record<string, any>) => ({
              pieceItemId: k.pieceItemId,
              code: k.piece?.code ?? '',
              name: k.piece?.description || k.piece?.code || '',
              dailyRate: Number(k.piece?.dailyRate ?? 0),
              qtyPer: String(Number(k.qtyPer)),
              perUnits: String(k.perUnits),
              rounding: k.rounding,
              minQty: String(k.minQty),
              billing: k.billing,
              clientVisible: !!k.clientVisible,
              suppressIfOrdered: !!k.suppressIfOrdered,
            })),
          )
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false) })
      return () => { cancelled = true }
    }, [itemId])

    // Typeahead against the same search the order form uses.
    useEffect(() => {
      const q = query.trim()
      if (q.length < 2) { setResults([]); return }
      let cancelled = false
      setSearching(true)
      const t = setTimeout(() => {
        fetch(`/api/inventory/search?q=${encodeURIComponent(q)}&limit=8`)
          .then((r) => r.json())
          .then((d) => { if (!cancelled) setResults(Array.isArray(d?.items) ? d.items : []) })
          .catch(() => {})
          .finally(() => { if (!cancelled) setSearching(false) })
      }, 200)
      return () => { cancelled = true; clearTimeout(t) }
    }, [query])

    const patch = useCallback((i: number, next: Partial<Row>) => {
      dirty.current = true
      setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...next } : r)))
    }, [])

    const add = (hit: SearchResult) => {
      setQuery(''); setResults([])
      if (hit.id === itemId) return
      if (rows.some((r) => r.pieceItemId === hit.id)) return
      dirty.current = true
      setRows((prev) => [
        ...prev,
        {
          pieceItemId: hit.id,
          code: hit.code,
          name: hit.description || hit.code,
          dailyRate: Number(hit.dailyRate ?? 0),
          qtyPer: '1',
          perUnits: '1',
          rounding: 'CEIL',
          minQty: '0',
          billing: 'FREE',
          clientVisible: true,
          suppressIfOrdered: true,
        },
      ])
    }

    const remove = (i: number) => {
      dirty.current = true
      setRows((prev) => prev.filter((_, idx) => idx !== i))
    }

    useImperativeHandle(ref, () => ({
      save: async () => {
        // Nothing touched → don't spend a round-trip (and don't risk
        // rewriting a kit another session just edited).
        if (!dirty.current) return
        const res = await fetch(`/api/inventory/items/${itemId}/kit-pieces`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kitPieces: rows.map((r) => ({
              pieceItemId: r.pieceItemId,
              qtyPer: Number(r.qtyPer) || 1,
              perUnits: Math.max(1, Math.floor(Number(r.perUnits)) || 1),
              rounding: r.rounding,
              minQty: Math.max(0, Math.floor(Number(r.minQty)) || 0),
              billing: r.billing,
              clientVisible: r.clientVisible,
              suppressIfOrdered: r.suppressIfOrdered,
            })),
          }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error || `Included accessories: HTTP ${res.status}`)
        }
        dirty.current = false
      },
    }), [itemId, rows])

    const sample = Math.max(0, Math.floor(Number(sampleQty) || 0))

    return (
      <div className="space-y-3 border-t border-lt-hairline pt-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <label className={label}>Included accessories</label>
            <p className="text-[11px] text-lt-fg3 leading-tight">
              Pieces that go out with this item automatically. Quantities are a ratio
              off what&apos;s rented; free pieces quote at $0 and still reach the pick list.
            </p>
          </div>
        </div>

        {loading ? (
          <p className="text-xs text-lt-fg3">Loading…</p>
        ) : (
          <>
            {rows.length === 0 && (
              <p className="text-xs text-lt-fg3">None — {itemName} goes out on its own.</p>
            )}

            {rows.length > 0 && (
              <div className="flex items-center gap-2 text-[11px] text-lt-fg2">
                <span>Preview: if a client rents</span>
                <input
                  className="w-16 bg-lt-card border border-lt-hairline rounded px-2 py-1 text-xs tabular-nums text-lt-fg focus:outline-none focus:border-amber-500"
                  type="number"
                  min={0}
                  value={sampleQty}
                  onChange={(e) => setSampleQty(e.target.value)}
                />
                <span>of these, we also send:</span>
              </div>
            )}

            {rows.map((r, i) => {
              const ratio = {
                qtyPer: Number(r.qtyPer) || 0,
                perUnits: Math.max(1, Math.floor(Number(r.perUnits)) || 1),
                rounding: r.rounding,
                minQty: Math.max(0, Math.floor(Number(r.minQty)) || 0),
              }
              const preview = resolveKitQuantity(ratio, sample)
              return (
                <div key={r.pieceItemId} className="bg-lt-inner border border-lt-hairline rounded-lg p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-lt-fg truncate">{r.name}</div>
                      <div className="text-[11px] font-mono text-lt-fg3">{r.code}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="text-xs text-chip-bad-fg hover:opacity-80"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <label className={label}>Qty</label>
                      <input
                        className={field + ' tabular-nums'}
                        type="number" min={0} step="0.25"
                        value={r.qtyPer}
                        onChange={(e) => patch(i, { qtyPer: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className={label}>Per</label>
                      <input
                        className={field + ' tabular-nums'}
                        type="number" min={1} step={1}
                        value={r.perUnits}
                        onChange={(e) => patch(i, { perUnits: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className={label}>Round</label>
                      <select className={field} value={r.rounding} onChange={(e) => patch(i, { rounding: e.target.value as Row['rounding'] })}>
                        <option value="CEIL">Up</option>
                        <option value="FLOOR">Down</option>
                      </select>
                    </div>
                    <div>
                      <label className={label}>Min</label>
                      <input
                        className={field + ' tabular-nums'}
                        type="number" min={0} step={1}
                        value={r.minQty}
                        onChange={(e) => patch(i, { minQty: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={label}>Billing</label>
                      <select className={field} value={r.billing} onChange={(e) => patch(i, { billing: e.target.value as Row['billing'] })}>
                        <option value="FREE">Free — included</option>
                        <option value="CHARGED">Charged at catalog rate</option>
                      </select>
                    </div>
                    <div className="flex flex-col justify-end gap-1 pb-1">
                      <label className="flex items-center gap-2 text-[11px] text-lt-fg2">
                        <input type="checkbox" checked={r.clientVisible} onChange={(e) => patch(i, { clientVisible: e.target.checked })} />
                        Show on the quote
                      </label>
                      <label className="flex items-center gap-2 text-[11px] text-lt-fg2">
                        <input type="checkbox" checked={r.suppressIfOrdered} onChange={(e) => patch(i, { suppressIfOrdered: e.target.checked })} />
                        Skip if already ordered
                      </label>
                    </div>
                  </div>

                  <p className="text-[11px] text-lt-fg3">
                    {describeKitRatio(ratio)} · {sample} → <span className="font-bold tabular-nums text-lt-fg2">{preview}</span>
                    {r.billing === 'CHARGED' && r.dailyRate > 0 ? ` · $${r.dailyRate}/day each` : ' · no charge'}
                  </p>
                </div>
              )
            })}

            <div className="relative">
              <input
                className={field}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="+ Add an accessory — search inventory…"
              />
              {query.trim().length >= 2 && (
                <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-lt-card border border-lt-hairline rounded-lg shadow-lg">
                  {searching && <div className="px-3 py-2 text-xs text-lt-fg3">Searching…</div>}
                  {!searching && results.length === 0 && (
                    <div className="px-3 py-2 text-xs text-lt-fg3">No matches.</div>
                  )}
                  {results
                    .filter((hit) => hit.id !== itemId && !rows.some((r) => r.pieceItemId === hit.id))
                    .map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        onClick={() => add(hit)}
                        className="block w-full text-left px-3 py-2 hover:bg-lt-inner"
                      >
                        <div className="text-sm text-lt-fg truncate">{hit.description || hit.code}</div>
                        <div className="text-[11px] font-mono text-lt-fg3">{hit.code}</div>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    )
  },
)
