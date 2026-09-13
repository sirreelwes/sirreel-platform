'use client'

/**
 * Cart pill for the public-site header (2026-09-12).
 *
 * The site-search "+" can now drop items into the cart from any public
 * page, which only works if there's somewhere on screen that says so.
 * This is that: a live unit count that appears the moment something goes
 * in, and goes to the order form with the cart panel open.
 *
 * HIDDEN WHILE EMPTY on purpose. An empty cart icon on a marketing header
 * is furniture — the "ORDER →" button already points at the same form.
 * The pill earns its space only once the client has started a list.
 *
 * The count comes from useSupplyCart, whose store is module-level and
 * shared, so an add made in the search dropdown re-renders this pill on
 * the same tick — no reload, no polling.
 */

import Link from 'next/link'
import { ShoppingCart } from 'lucide-react'
import { useSupplyCart } from '@/hooks/useSupplyCart'
import { PUBLIC_CART_HREF } from '@/lib/site/publicNav'

export function PublicCartPill({
  /** Compact metrics for the mobile header row. */
  size = 'md',
  className = '',
}: {
  size?: 'md' | 'sm'
  className?: string
}) {
  const { totalUnits } = useSupplyCart()
  // Also false on the server and on the first client paint (the store
  // hydrates in an effect), so the markup matches and React doesn't warn.
  if (totalUnits <= 0) return null

  const metrics =
    size === 'sm'
      ? 'px-3 py-1.5 text-[11.5px] gap-1.5'
      : 'px-4 py-2 text-[12.5px] gap-2'

  return (
    <Link
      href={PUBLIC_CART_HREF}
      aria-label={`Cart — ${totalUnits} item${totalUnits === 1 ? '' : 's'}. Review and send your request.`}
      className={`inline-flex items-center rounded-full bg-[#4DB1C6] text-[#0c0c0d] hover:bg-[#79c9d9] font-bold uppercase tracking-[0.08em] whitespace-nowrap transition-colors ${metrics} ${className}`}
      style={{ fontFamily: 'Archivo, sans-serif' }}
    >
      <ShoppingCart size={size === 'sm' ? 14 : 15} aria-hidden />
      {totalUnits}
    </Link>
  )
}
