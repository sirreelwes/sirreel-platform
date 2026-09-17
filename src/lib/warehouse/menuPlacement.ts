/**
 * Where a typeahead menu opens, and how tall it is allowed to be.
 *
 * Oliver, relaying the warehouse twice (2026-09-16 and again 2026-09-17,
 * with a photo of the screen): "the dropdown box can't be seen fully,
 * which makes it harder for warehouse to add items during checkout."
 * Sal, adding a ratchet strap to a check-out sheet, could see the
 * question and one hit.
 *
 * The naive fix — open upward when the bottom is close — is not enough,
 * and that is the trap this module exists to hold shut. A menu with a
 * FIXED height is cut off whenever neither side has that much room,
 * which on a laptop viewport is most of the time: the field sits in the
 * middle of a long sheet, with a couple of hundred pixels each way. So
 * the height is measured, not assumed, and when there is genuinely
 * nowhere to open the caller is told to bring the field into view
 * instead of rendering a two-line sliver.
 *
 * Pure — no DOM, no React — so the arithmetic that decides whether the
 * warehouse can read the menu is testable without a browser.
 * `npm run test:menu-placement`.
 */

/** As tall as the menu ever gets. A longer one is harder to scan than a
 *  scrolled one, and the catalog typeahead returns at most 6 hits. */
export const MENU_IDEAL_PX = 240
/** Header plus about two rows — the least that is worth opening. */
export const MENU_MIN_PX = 132
/** The gap the menu sits off the field (Tailwind mt-1 / mb-1). */
export const MENU_GAP_PX = 4
/** Breathing room so the menu never sits flush on the clipping edge. */
export const MENU_EDGE_PX = 8

export interface MenuSpace {
  /** The field's top and bottom, in viewport coordinates. */
  fieldTop: number
  fieldBottom: number
  /** What will clip the menu — the nearest scrolling ancestor's edges,
   *  narrowed to the window. NOT the window alone: the staff shell's
   *  <main> is `overflow-y-auto` and its bottom edge is the real one. */
  boundsTop: number
  boundsBottom: number
}

export interface MenuPlacement {
  /** Open above the field rather than below it. */
  up: boolean
  /** The menu's max height. Never below MENU_MIN_PX — at that point the
   *  answer is `nudge`, not a shorter menu. */
  maxHeight: number
  /** Neither side can hold a readable menu: scroll the field into view
   *  and measure again. */
  nudge: boolean
}

export function placeMenu(space: MenuSpace): MenuPlacement {
  const pad = MENU_GAP_PX + MENU_EDGE_PX
  const below = space.boundsBottom - space.fieldBottom - pad
  const above = space.fieldTop - space.boundsTop - pad

  // Upward ONLY when it buys something: the space below cannot hold the
  // menu AND the space above is the roomier side. Flipping up toward an
  // even tighter edge is the same complaint in the other direction.
  const up = below < Math.min(MENU_IDEAL_PX, above)
  const room = Math.floor(Math.max(0, up ? above : below))

  if (room < MENU_MIN_PX) return { up, maxHeight: MENU_MIN_PX, nudge: true }
  return { up, maxHeight: Math.min(MENU_IDEAL_PX, room), nudge: false }
}
