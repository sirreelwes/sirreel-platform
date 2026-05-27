'use client'

/**
 * Unified cart hook for the production-order shop. Backed by
 * sessionStorage so an accidental tab refresh doesn't nuke a half-
 * built order; cleared on resetCart() and after successful
 * submission.
 *
 * Each cart line carries:
 *   - itemKind: 'SUPPLY' | 'VEHICLE'  (string union, not a
 *     Prisma enum — kept loose so commit-2 lands without a DB
 *     migration; the supply-request submit handler discriminates
 *     on this to look up either an InventoryItem or a
 *     VehicleCategory).
 *   - itemId: FK to InventoryItem (SUPPLY) or VehicleCategory
 *     (VEHICLE). NOT unique on the cart by itself — the same
 *     item with different dates is two separate lines.
 *   - qty: integer count.
 *   - pickupDate, returnDate: YYYY-MM-DD per-line dates. Required
 *     on every line; no inquiry-level date fallback (spec STEP 5:
 *     "Dates live on cart lines only.")
 *
 * The Map is keyed by `cartLineId = ${itemKind}:${itemId}:${pickup}:${return}`
 * so:
 *   - Same item + same dates → increments qty on the existing line.
 *   - Same item + different dates → new line.
 *   - React keys + setQty/setDates/removeLine all address by
 *     cartLineId; itemId alone is not a stable line identifier.
 *
 * sessionStorage key bumped v2 → v3 because the line shape changed
 * (added itemKind/itemId/pickupDate/returnDate, renamed quantity →
 * qty). Stale v2 payloads are dropped on hydration — in-progress
 * carts on the same tab get reset.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

export type ItemKind = 'SUPPLY' | 'VEHICLE'

/**
 * Display fields the cart UI needs without a re-fetch. The
 * server snapshots the canonical name/price/category at submit
 * time from the source tables, so these are display-only.
 *
 * For VEHICLE lines, price=0 when VehicleCategory.dailyRate is
 * null (price-on-quote). type='VEHICLE'. category='Vehicles'
 * (literal) so the cart-panel category grouping in commit 5
 * works uniformly across kinds.
 */
export interface CartLineDisplayInfo {
  name: string
  price: number       // 0 = price-on-quote (vehicles without dailyRate)
  type: string        // LineItemType for supplies; 'VEHICLE' for vehicles
  category: string    // grouping label
}

export interface CartLine extends CartLineDisplayInfo {
  cartLineId: string  // composite stable id — react key + edit addressing
  itemKind: ItemKind
  itemId: string
  qty: number
  pickupDate: string  // YYYY-MM-DD
  returnDate: string  // YYYY-MM-DD
}

export interface AddToCartArgs extends CartLineDisplayInfo {
  itemKind: ItemKind
  itemId: string
  pickupDate: string
  returnDate: string
  qty?: number        // defaults to 1
}

const STORAGE_KEY = 'sr_supply_cart_v3'

export function cartLineKey(kind: ItemKind, itemId: string, pickup: string, returnD: string): string {
  return `${kind}:${itemId}:${pickup}:${returnD}`
}

export function useSupplyCart() {
  const [cart, setCart] = useState<Map<string, CartLine>>(() => new Map())
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (raw) {
        const arr = JSON.parse(raw) as CartLine[]
        const next = new Map<string, CartLine>()
        for (const l of arr) {
          // Defensive: drop any line that doesn't match the v3 shape.
          if (l?.cartLineId && l.itemKind && l.itemId && l.pickupDate && l.returnDate && l.qty > 0) {
            next.set(l.cartLineId, l)
          }
        }
        setCart(next)
      }
    } catch {}
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...cart.values()]))
    } catch {}
  }, [cart, hydrated])

  /**
   * Add a line, or merge qty into an existing identical line
   * (same kind + item + dates). Returns the cartLineId for the
   * caller to address subsequent edits.
   */
  const addToCart = useCallback((args: AddToCartArgs): string => {
    const key = cartLineKey(args.itemKind, args.itemId, args.pickupDate, args.returnDate)
    const addQty = Math.max(1, Math.floor(args.qty ?? 1))
    setCart((prev) => {
      const next = new Map(prev)
      const existing = next.get(key)
      if (existing) {
        next.set(key, { ...existing, qty: existing.qty + addQty })
      } else {
        next.set(key, {
          cartLineId: key,
          itemKind: args.itemKind,
          itemId: args.itemId,
          qty: addQty,
          pickupDate: args.pickupDate,
          returnDate: args.returnDate,
          name: args.name,
          price: args.price,
          type: args.type,
          category: args.category,
        })
      }
      return next
    })
    return key
  }, [])

  const setQty = useCallback((cartLineId: string, qty: number) => {
    setCart((prev) => {
      const next = new Map(prev)
      const line = next.get(cartLineId)
      if (!line) return prev
      if (qty <= 0) next.delete(cartLineId)
      else next.set(cartLineId, { ...line, qty: Math.min(1000, Math.max(1, Math.floor(qty))) })
      return next
    })
  }, [])

  /**
   * Change a line's pickup/return dates. Because cartLineId
   * encodes the dates, changing dates re-keys the line. If the
   * new (kind, item, dates) tuple already exists as another line,
   * the two are merged (qty summed) — keeps the cart deduped.
   */
  const setDates = useCallback((cartLineId: string, pickupDate: string, returnDate: string) => {
    setCart((prev) => {
      const line = prev.get(cartLineId)
      if (!line) return prev
      const newKey = cartLineKey(line.itemKind, line.itemId, pickupDate, returnDate)
      if (newKey === cartLineId) return prev
      const next = new Map(prev)
      next.delete(cartLineId)
      const collision = next.get(newKey)
      if (collision) {
        next.set(newKey, { ...collision, qty: collision.qty + line.qty })
      } else {
        next.set(newKey, { ...line, cartLineId: newKey, pickupDate, returnDate })
      }
      return next
    })
  }, [])

  const removeLine = useCallback((cartLineId: string) => {
    setCart((prev) => {
      if (!prev.has(cartLineId)) return prev
      const next = new Map(prev)
      next.delete(cartLineId)
      return next
    })
  }, [])

  const resetCart = useCallback(() => {
    setCart(new Map())
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {}
  }, [])

  const lines = useMemo(() => [...cart.values()], [cart])
  const totalUnits = useMemo(() => lines.reduce((s, l) => s + l.qty, 0), [lines])
  // Per-day estimate — vehicles with price=0 contribute nothing
  // (price-on-quote). Final pricing is confirmed in the quote.
  const totalPerDay = useMemo(() => lines.reduce((s, l) => s + l.price * l.qty, 0), [lines])
  const hasEquipment = useMemo(
    () => lines.some((l) => l.type === 'EQUIPMENT' || l.type === 'VEHICLE'),
    [lines],
  )

  return {
    cart,
    lines,
    totalUnits,
    totalPerDay,
    hasEquipment,
    addToCart,
    setQty,
    setDates,
    removeLine,
    resetCart,
  }
}
