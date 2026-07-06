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
  slot: 'trucking' | 'stages' | 'standing-sets' | 'led-wall' | 'supplies'
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
}

const ORDER_FORM_HREF = '/order/supplies'

export const HOME_TILES: HomeTile[] = [
  { slot: 'trucking', label: 'Trucking', color: '#d99a2b', colorDeep: '#9c6c14', tagline: 'Production vehicles, ready to roll', mode: 'link', href: '/vehicles' },
  { slot: 'stages', label: 'Stages', color: '#c0392b', colorDeep: '#822015', tagline: 'Stage space in Sun Valley', mode: 'coming-soon' },
  { slot: 'standing-sets', label: 'Standing Sets', color: '#2b7fd9', colorDeep: '#17548f', tagline: 'Turnkey standing sets', mode: 'coming-soon' },
  { slot: 'led-wall', label: 'LED Wall', color: '#4caf50', colorDeep: '#2e6d31', tagline: 'Virtual production volume', mode: 'coming-soon' },
  { slot: 'supplies', label: 'Supplies & Equipment', color: '#7e57c2', colorDeep: '#523584', tagline: 'Order online — on the truck when you need it', mode: 'order', href: ORDER_FORM_HREF },
]
