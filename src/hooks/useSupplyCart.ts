'use client'

/**
 * Shared cart hook for the supply-ordering flow. Backed by
 * sessionStorage so an accidental tab refresh doesn't nuke a
 * half-built order; cleared on resetCart() and after successful
 * submission. The cart total here is a per-day estimate (price ×
 * qty), matching the mockup's "Est. / day" framing — the
 * submission endpoint multiplies by rental days from the form
 * to produce the Inquiry.estimatedValue snapshot.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

export interface CatalogItem {
  id: string
  name: string
  price: number
  type: string
  category: string
}

export interface CartLine extends CatalogItem {
  quantity: number
}

const STORAGE_KEY = 'sr_supply_cart_v2'

export function useSupplyCart() {
  const [cart, setCart] = useState<Map<string, CartLine>>(() => new Map())
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (raw) {
        const arr = JSON.parse(raw) as CartLine[]
        const next = new Map<string, CartLine>()
        for (const l of arr) if (l?.id && l.quantity > 0) next.set(l.id, l)
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

  const addToCart = useCallback((item: CatalogItem) => {
    setCart((prev) => {
      const next = new Map(prev)
      const existing = next.get(item.id)
      if (existing) {
        next.set(item.id, { ...existing, quantity: existing.quantity + 1 })
      } else {
        next.set(item.id, { ...item, quantity: 1 })
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

  const resetCart = useCallback(() => {
    setCart(new Map())
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {}
  }, [])

  const lines = useMemo(() => [...cart.values()], [cart])
  const totalUnits = useMemo(() => lines.reduce((s, l) => s + l.quantity, 0), [lines])
  const totalPerDay = useMemo(() => lines.reduce((s, l) => s + l.price * l.quantity, 0), [lines])
  const hasEquipment = useMemo(() => lines.some((l) => l.type === 'EQUIPMENT'), [lines])

  return { cart, lines, totalUnits, totalPerDay, hasEquipment, addToCart, setQty, resetCart }
}
