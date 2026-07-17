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
  // ── Reorder origin tracking (magic-link past-order toggles) ──
  // ownerOrderId: the past order whose toggle CREATED this line;
  // undefined = the user created it. associatedOrderIds: every past
  // order that references this item while toggled on (owner included)
  // — used to clear associations on toggle-off without removing
  // user-owned lines. modifiedByUser: any user edit (qty change,
  // stepper, re-add) flips this; a modified line survives toggle-off
  // and becomes user-owned.
  ownerOrderId?: string
  associatedOrderIds?: string[]
  modifiedByUser?: boolean
  /** Shoot-days CLAIM (Wes ruling B) — the client's requested working-day
   *  count for gear/vehicle rentals. A REQUEST the agent confirms in HQ;
   *  shown-provisional only, never a price by itself. undefined/null =
   *  no claim (bill the full rental period). */
  claimedDays?: number | null
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
        // User-driven add on an existing line — a user edit. If the
        // line came from a past-order toggle it becomes user-modified
        // (and will survive that order's toggle-off).
        next.set(key, { ...existing, qty: existing.qty + addQty, modifiedByUser: true })
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
      else next.set(cartLineId, { ...line, qty: Math.min(1000, Math.max(1, Math.floor(qty))), modifiedByUser: true })
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

  /** Set/clear the line's shoot-days claim. Clamped 1..computed-days-
   *  is deliberately NOT enforced here — it's a request; server + agent
   *  sanity-check it. Values equal to the computed span clear the claim. */
  const setClaimedDays = useCallback((cartLineId: string, claimed: number | null) => {
    setCart((prev) => {
      const line = prev.get(cartLineId)
      if (!line) return prev
      const computed = rentalDaysBetween(line.pickupDate, line.returnDate)
      const normalized =
        claimed == null || !Number.isInteger(claimed) || claimed < 1 || claimed > 365 || claimed === computed
          ? null
          : claimed
      if ((line.claimedDays ?? null) === normalized) return prev
      const next = new Map(prev)
      next.set(cartLineId, { ...line, claimedDays: normalized, modifiedByUser: true })
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

  const mergeOrderLines = useCallback((orderId: string, incoming: AddToCartArgs[]) => {
    setCart((prev) => applyMergeOrder(prev, orderId, incoming))
  }, [])

  const unmergeOrder = useCallback((orderId: string) => {
    setCart((prev) => applyUnmergeOrder(prev, orderId))
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
  // Full-window estimate — multiplies by days for rentals (VEHICLE or
  // EQUIPMENT supplies); flat for EXPENDABLE etc. price=0 lines are
  // price-on-quote and contribute zero. Used by the cart-panel EST.
  // TOTAL replacing the older EST. /DAY summary.
  const totalEstimate = useMemo(
    () => lines.reduce((s, l) => s + lineEstimate(l), 0),
    [lines],
  )
  const hasEquipment = useMemo(
    () => lines.some((l) => l.type === 'EQUIPMENT' || l.type === 'VEHICLE'),
    [lines],
  )
  const hasPriceOnQuote = useMemo(() => lines.some((l) => l.price === 0), [lines])

  return {
    cart,
    lines,
    totalUnits,
    totalPerDay,
    totalEstimate,
    hasEquipment,
    hasPriceOnQuote,
    addToCart,
    setQty,
    setDates,
    setClaimedDays,
    removeLine,
    mergeOrderLines,
    unmergeOrder,
    resetCart,
  }
}

/**
 * Toggle a past order ON — merge its lines into the cart (pure; the
 * hook wraps this in setCart). Exact reorder semantics:
 *   - item NOT in cart → new line OWNED by `orderId`, order's qty,
 *     modifiedByUser=false.
 *   - item ALREADY in cart (any owner) → qty untouched; the line is
 *     merely ASSOCIATED with `orderId`.
 */
export function applyMergeOrder(
  prev: Map<string, CartLine>,
  orderId: string,
  incoming: AddToCartArgs[],
): Map<string, CartLine> {
  const next = new Map(prev)
  for (const args of incoming) {
    const key = cartLineKey(args.itemKind, args.itemId, args.pickupDate, args.returnDate)
    const existing = next.get(key)
    if (existing) {
      const assoc = new Set(existing.associatedOrderIds ?? [])
      assoc.add(orderId)
      next.set(key, { ...existing, associatedOrderIds: [...assoc] })
    } else {
      next.set(key, {
        cartLineId: key,
        itemKind: args.itemKind,
        itemId: args.itemId,
        qty: Math.max(1, Math.floor(args.qty ?? 1)),
        pickupDate: args.pickupDate,
        returnDate: args.returnDate,
        name: args.name,
        price: args.price,
        type: args.type,
        category: args.category,
        ownerOrderId: orderId,
        associatedOrderIds: [orderId],
        modifiedByUser: false,
      })
    }
  }
  return next
}

/**
 * Toggle a past order OFF (pure).
 *   - lines OWNED by it, never user-modified, no other order attached
 *     → removed.
 *   - lines owned by it but ALSO associated with another toggled-on
 *     order → ownership transfers to that order (the other toggle is
 *     still ON; its item must not vanish out from under it).
 *   - lines owned by it but user-modified → kept at the user's qty,
 *     now user-owned.
 *   - lines merely associated → association cleared, line untouched.
 *   - pure user lines → untouched.
 */
export function applyUnmergeOrder(
  prev: Map<string, CartLine>,
  orderId: string,
): Map<string, CartLine> {
  const next = new Map(prev)
  for (const [key, line] of prev) {
    const assoc = (line.associatedOrderIds ?? []).filter((id) => id !== orderId)
    if (line.ownerOrderId === orderId) {
      if (line.modifiedByUser) {
        next.set(key, { ...line, ownerOrderId: undefined, associatedOrderIds: assoc })
      } else if (assoc.length > 0) {
        next.set(key, { ...line, ownerOrderId: assoc[0], associatedOrderIds: assoc })
      } else {
        next.delete(key)
      }
    } else if ((line.associatedOrderIds ?? []).includes(orderId)) {
      next.set(key, { ...line, associatedOrderIds: assoc })
    }
  }
  return next
}

/** Days inclusive between pickup and return (min 1). */
// Ruled formula: computedDays = max(1, returnDate − pickupDate),
// EXCLUSIVE count. Matches src/lib/orders/days.ts computeDays() and the
// server snapshot in /api/public/supply-request — keep all three in
// lockstep.
export function rentalDaysBetween(pickup: string, returnD: string): number {
  const s = new Date(`${pickup}T00:00:00Z`).getTime()
  const e = new Date(`${returnD}T00:00:00Z`).getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 1
  return Math.max(1, Math.round((e - s) / 86_400_000))
}

/** Per-line $ estimate — matches the server snapshot math in
 *  /api/public/supply-request. Vehicles and EQUIPMENT supplies are
 *  rentals (× days); everything else is a flat per-unit charge.
 *  price=0 → price-on-quote, returns 0. */
export function lineEstimate(line: CartLine): number {
  if (line.price === 0) return 0
  const isRental = line.itemKind === 'VEHICLE' || line.type === 'EQUIPMENT'
  // PROVISIONAL: a shoot-days claim shows its effect in the estimate so
  // the client sees what they're requesting — the server never prices
  // from this; the agent confirms in HQ.
  const days = isRental ? line.claimedDays ?? rentalDaysBetween(line.pickupDate, line.returnDate) : 1
  return line.price * line.qty * days
}
