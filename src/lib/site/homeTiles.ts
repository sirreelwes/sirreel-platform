/**
 * Home diagonal service-nav tiles — single source of truth for the 5
 * bands (label · color · destination · media slot). Consumed by the
 * Home page, the ServiceTiles component, and the /admin/home-tiles
 * uploader so all three stay in lockstep.
 *
 * These tile colors deliberately OVERRIDE the site's gold-only palette
 * for the Home page only (per the 2026-07-06 diagonal-home brief).
 */

export type TileMode = 'link' | 'order' | 'coming-soon'

export interface HomeTile {
  /** Admin/media slot id (also the public proxy suffix: tile-<slot>). */
  slot: 'trucking' | 'stages' | 'standing-sets' | 'led-wall' | 'supplies' | 'radios-wifi' | 'grip-electric' | 'wardrobe-makeup'
  label: string
  /** Saturated brand color for this tile (collapsed solid + duotone tint). */
  color: string
  /** Deepened shade for the no-image hover state. */
  colorDeep: string
  /** Short tagline that fades in on hover (desktop). */
  tagline: string
  mode: TileMode
  /** Destination for link/order tiles; undefined for coming-soon. */
  href?: string
  /**
   * Mobile swipe-to-reveal express action (see SwipeableMobileTile). The
   * label + destination are DATA-DRIVEN per tile so the revealed button
   * matches how that service transacts, independent of the tile's normal
   * tap `href`:
   *   - self-serve (adds to cart) → "Add Items" → order form (deep-linked)
   *   - browse                    → "View Vehicles" → /vehicles
   *   - studio/inquiry            → "Check Availability" → contact intake
   *   - agent-quote               → "Request a Quote" → contact intake
   * The inquiry actions reuse the public /contact intake with a prefilled
   * subject (lands an Inquiry in the staff pipeline; no auto-reply).
   */
  swipe: { label: string; href: string }
}

import { contactPrefillHref } from '@/lib/site/publicNav'

const ORDER_FORM_HREF = '/order/supplies'

export const HOME_TILES: HomeTile[] = [
  // Browse: the swipe jumps straight to the vehicle gallery.
  { slot: 'trucking', label: 'Trucks and Vans', color: '#d99a2b', colorDeep: '#9c6c14', tagline: 'Production vehicles, ready to roll', mode: 'link', href: '/vehicles',
    swipe: { label: 'View Vehicles', href: '/vehicles' } },
  // Studio inquiries (coming-soon tiles): swipe opens the contact intake
  // with an "Availability: <service>" subject — lands in the staff pipeline.
  { slot: 'stages', label: 'Stages', color: '#c0392b', colorDeep: '#822015', tagline: 'Stage space in Sun Valley', mode: 'coming-soon',
    swipe: { label: 'Check Availability', href: contactPrefillHref('Availability: Stages') } },
  { slot: 'standing-sets', label: 'Standing Sets', color: '#2b7fd9', colorDeep: '#17548f', tagline: 'Turnkey standing sets', mode: 'coming-soon',
    swipe: { label: 'Check Availability', href: contactPrefillHref('Availability: Standing Sets') } },
  { slot: 'led-wall', label: 'LED Wall', color: '#4caf50', colorDeep: '#2e6d31', tagline: 'Virtual production volume', mode: 'coming-soon',
    swipe: { label: 'Check Availability', href: contactPrefillHref('Availability: LED Wall') } },
  // Self-serve: "Add Items" opens the full supplies catalog (no category —
  // "Production Supplies" is the whole form, not a filterable section).
  { slot: 'supplies', label: 'Supplies & Equipment', color: '#7e57c2', colorDeep: '#523584', tagline: 'Order online — on the truck when you need it', mode: 'order', href: ORDER_FORM_HREF,
    swipe: { label: 'Add Items', href: ORDER_FORM_HREF } },
  // Self-serve: deep-links the order form to the Radios & WiFi section.
  { slot: 'radios-wifi', label: 'Radios & WiFi', color: '#0e9db0', colorDeep: '#0a6b78', tagline: 'Walkies, comms & on-set WiFi', mode: 'order', href: `${ORDER_FORM_HREF}?category=radios-wifi`,
    swipe: { label: 'Add Items', href: `${ORDER_FORM_HREF}?category=radios-wifi` } },
  // Quote-request: routes to the contact intake with a prefilled subject
  // (matches the Equipment ▾ "Request a quote" grip/lighting flow).
  { slot: 'grip-electric', label: 'Grip & Electric', color: '#e0701f', colorDeep: '#9c4c12', tagline: 'Lighting, grip & power — request a quote', mode: 'link', href: contactPrefillHref('Equipment quote: Grip & Electric'),
    swipe: { label: 'Request a Quote', href: contactPrefillHref('Quote: Grip & Electric') } },
  // Self-serve catalog section (Wardrobe & Makeup exists on the order form):
  // "Add Items" deep-links to that section.
  { slot: 'wardrobe-makeup', label: 'Wardrobe & Makeup', color: '#d6448c', colorDeep: '#912a5c', tagline: 'Chairs, mirrors, steamers & racks', mode: 'order', href: `${ORDER_FORM_HREF}?category=wardrobe-makeup`,
    swipe: { label: 'Add Items', href: `${ORDER_FORM_HREF}?category=wardrobe-makeup` } },
]
