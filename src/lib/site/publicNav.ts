/**
 * Public site navigation registry — the single source of truth for the
 * SirReel public marketing nav (sirreel.com / orders.sirreel.com).
 *
 * Cinelease-structure shell (2026-07-06): the SirReel wordmark sits
 * centered above the nav row and links to Home, so Home is NOT a nav
 * item. Items with `live: false` render visibly but non-clickable
 * ("coming soon") so the site map shows without dead links or 404s.
 * Flip `live: true` once a page ships.
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
  { label: 'Vehicles', href: '/vehicles', live: true },
  { label: 'Studios', href: '/studios', live: false },
  { label: 'Supplies & Equipment', href: '/order/supplies', live: true },
  // Same-page anchor to the Home page's contact band; from any other
  // public page it navigates to /home and scrolls to #contact.
  { label: 'Contact', href: '/home#contact', live: true },
]

/**
 * The ORDER call-to-action — the gold-outline "Start an Order" button at
 * the nav row's right. Always live; routes to the public order form
 * (/order/supplies, which is also what orders.sirreel.com/ rewrites to).
 */
export const PUBLIC_ORDER_CTA = { label: 'Start an Order', href: '/order/supplies' }

/** Home target for the centered wordmark. */
export const PUBLIC_HOME_HREF = '/home'

/**
 * Canonical public contact values — mirrors the footer copy the site has
 * always shown. Kept here so the utility bar, footer, and contact band
 * read from one place instead of triplicating the strings.
 */
export const PUBLIC_CONTACT = {
  phone: '888.477.7335',
  phoneHref: 'tel:+18884777335',
  email: 'info@sirreel.com',
  emailHref: 'mailto:info@sirreel.com',
  address: '8500 Lankershim Blvd, Sun Valley, CA 91352',
  entity: 'SirReel Studio Services',
} as const
