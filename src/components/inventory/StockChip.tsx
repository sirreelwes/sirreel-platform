'use client'

/**
 * The little number beside a line's quantity: how many of this item are
 * free for the order's dates. Red the moment the line asks for more.
 *
 * RentalWorks showed this and the crew relied on it; HQ shipped without
 * it, so an agent quoting 40 ratchet straps had no way to know we own
 * 24 until the warehouse came up short. `src/lib/inventory/stock.ts`
 * computes the number (and documents what counts); this renders it.
 *
 * Two silences are deliberate:
 *   · UNIT_TRACKED rows (vehicles, stages) render nothing — their truth
 *     is the scheduler and the hold/assign UI already on the row.
 *   · An item nobody has counted (qtyOwned 0) renders nothing. 0 in
 *     that column means "never counted", not "we have none", and it is
 *     a quarter of the catalog-bound lines in the book; a red flag on
 *     every one of them is noise that teaches people to stop looking.
 *
 * `otherOnThisOrder` is what the SAME order already asks for elsewhere
 * — the stock API leaves the order being edited out of `committed`, so
 * a second line of the same item has to be netted here. That is also
 * what makes the number live: it moves while the agent types.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { stockVerdict, type ItemStock } from '@/lib/inventory/stock'

export type { ItemStock }
export { stockVerdict }

export interface StockChipProps {
  stock: ItemStock | null | undefined
  /** What this line is asking for right now (the value in the input). */
  requested: number
  /** Same item, other lines on THIS order, overlapping these dates. */
  otherOnThisOrder?: number
  /** Partner-fulfilled lines don't come off our shelf — render nothing. */
  subRented?: boolean
  className?: string
}

export function StockChip({
  stock,
  requested,
  otherOnThisOrder = 0,
  subRented = false,
  className = '',
}: StockChipProps) {
  if (subRented || !stock) return null
  const verdict = stockVerdict(stock, requested, otherOnThisOrder)
  if (!verdict.show) return null

  const { available, over, short } = verdict
  const shown = Math.max(0, available)

  const detail = [
    `${shown} of ${stock.onHand} free for these dates`,
    stock.committed > 0 ? `${stock.committed} out on other orders` : null,
    otherOnThisOrder > 0 ? `${otherOnThisOrder} on other lines of this order` : null,
    stock.quoted > 0 ? `${stock.quoted} more on quotes not yet approved` : null,
    over ? `This line is ${short} short — sub-rent it or cut the quantity.` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <span
      title={detail}
      aria-label={over ? `Only ${shown} available — ${short} short` : `${shown} available`}
      className={`inline-flex items-center gap-0.5 rounded px-1 text-[11px] leading-none tabular-nums whitespace-nowrap ${
        over
          ? 'bg-chip-bad-bg text-chip-bad-fg font-semibold'
          : 'text-lt-fg3'
      } ${className}`}
    >
      {shown}
      <span className={over ? 'font-normal' : ''}>avail</span>
    </span>
  )
}

/* ────────────────────────────────────────────────────────────────────
 * Fetching
 * ──────────────────────────────────────────────────────────────────── */

export type StockMap = Record<string, ItemStock>

/**
 * Pull stock for a set of catalog rows over one window.
 *
 * Refetches when the ids or the window change — the ids are joined into
 * a stable key first so a re-render that produces an equal-but-new array
 * does not re-request. `refresh()` is for after a write (a line added,
 * a quantity saved, a sub-rental filed) so the number a second agent
 * caused is picked up.
 */
export function useItemStock(args: {
  inventoryItemIds: string[]
  start: string | null | undefined
  end: string | null | undefined
  excludeOrderId?: string | null
  enabled?: boolean
}): { stock: StockMap; loading: boolean; refresh: () => void } {
  const { start, end, excludeOrderId = null, enabled = true } = args
  const idKey = [...new Set(args.inventoryItemIds.filter(Boolean))].sort().join(',')

  const [stock, setStock] = useState<StockMap>({})
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  // The in-flight request's key, so a slow response for an older window
  // can't overwrite a newer one.
  const latest = useRef('')

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!enabled || !idKey || !start || !end) {
      setStock({})
      return
    }
    const key = `${idKey}|${start}|${end}|${excludeOrderId ?? ''}|${nonce}`
    latest.current = key
    let cancelled = false
    setLoading(true)
    fetch('/api/inventory/stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start,
        end,
        excludeOrderId,
        inventoryItemIds: idKey.split(','),
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || latest.current !== key) return
        setStock((data?.stock as StockMap) ?? {})
      })
      .catch(() => {
        // A stock number is an aid, not a gate — a failed lookup just
        // renders no chips rather than blocking the order.
        if (!cancelled) setStock({})
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [idKey, start, end, excludeOrderId, enabled, nonce])

  return { stock, loading, refresh }
}
