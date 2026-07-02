/**
 * Public site navigation registry — the single source of truth for the
 * SirReel public marketing nav (orders.sirreel.com).
 *
 * This is the FIRST slice of moving sirreel.com into HQ. Only the pages we've
 * actually built are marked `live: true`; the rest render in the nav (so the
 * full site map is visible) but are NON-clickable placeholders — no dead links,
 * no 404s.
 *
 * To turn a page on later: build its route, then flip `live: true` here. That's
 * the only change the nav needs.
 */
export interface PublicNavItem {
  /** Visible label in the nav bar. */
  label: string
  /** Route it links to when live. */
  href: string
  /** When false, rendered visibly but inactive (not a link). */
  live: boolean
}

export const PUBLIC_NAV: PublicNavItem[] = [
  { label: 'Home', href: '/', live: false },
  { label: 'Studios', href: '/studios', live: false },
  { label: 'Vehicles', href: '/vehicles', live: true },
  { label: 'Equipment', href: '/equipment', live: false },
  { label: 'Forms', href: '/forms', live: false },
  { label: 'Contact', href: '/contact', live: false },
]

/**
 * The ORDER call-to-action, styled distinctly from the nav links (the amber
 * button on the current site). Always live — it routes to the public order
 * form (/order/supplies, which is also what orders.sirreel.com/ rewrites to).
 */
export const PUBLIC_ORDER_CTA = { label: 'Order', href: '/order/supplies', live: true }
