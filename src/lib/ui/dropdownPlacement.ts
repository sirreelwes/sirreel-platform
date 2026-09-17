/**
 * Where a portalled dropdown goes, given the input it hangs off and the part
 * of the page a person can actually SEE.
 *
 * The line-item combobox pins its list to the input with `position: fixed`
 * — always below, always up to 288px tall. That is fine on a desktop. On a
 * phone held sideways the viewport is ~375px tall to begin with, and the
 * moment the keyboard opens the VISIBLE part shrinks to a strip, often
 * with the focused input sitting near its bottom edge. A list pinned below
 * the input then paints under the keyboard, or off the bottom of the
 * screen entirely, and the rep sees a search box that appears to return
 * nothing. Wes 2026-09-17: "the items then are higher or lower than the
 * screen".
 *
 * So placement is decided against the VISUAL viewport (`window.visualViewport`
 * — the region not covered by the keyboard — falling back to the layout
 * viewport where the API is absent), in the same coordinate space
 * `getBoundingClientRect` reports in:
 *
 *   · below the input when there is room for a useful list there, or when
 *     there is at least as much room below as above;
 *   · above it otherwise, anchored by `bottom` so a short list still sits
 *     flush against the field instead of floating away from it;
 *   · never taller than the room it was given, so the tail of a long list
 *     scrolls inside the panel instead of vanishing off-screen;
 *   · never wider than what is left of the screen to its right.
 *
 * Pure — no DOM here — so the arithmetic is testable with the numbers a
 * phone reports. `npm run test:dropdown-placement`.
 */

export interface AnchorRect {
  top: number
  bottom: number
  left: number
  width: number
}

export interface VisibleViewport {
  /** Offset of the visible region from the layout viewport's top — the
   *  `visualViewport.offsetTop` a keyboard-shrunk page reports. */
  top: number
  height: number
  width: number
  /** The layout viewport's height (`window.innerHeight`) — what a fixed
   *  element's `bottom` is measured from. */
  layoutHeight: number
}

export interface DropdownPlacement {
  placement: 'below' | 'above'
  /** Set for 'below'. */
  top?: number
  /** Set for 'above' — a CSS `bottom`, measured from the layout viewport. */
  bottom?: number
  left: number
  minWidth: number
  maxWidth: number
  maxHeight: number
}

/** The list's natural cap — Tailwind's `max-h-72`. */
export const DROPDOWN_MAX_HEIGHT = 288
/** Space between the input's edge and the panel. */
export const DROPDOWN_GAP = 4
/** Below this much room a list is not worth reading — three-ish rows. */
export const DROPDOWN_MIN_USEFUL = 120
/** Long names render in full up to this width, wrapping past it. */
export const DROPDOWN_MAX_WIDTH = 480
/** Keep the panel this far off the screen's right edge. */
const EDGE_INSET = 8

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export function placeDropdown(rect: AnchorRect, vp: VisibleViewport): DropdownPlacement {
  const visibleBottom = vp.top + vp.height
  const roomBelow = Math.max(0, visibleBottom - rect.bottom - DROPDOWN_GAP)
  const roomAbove = Math.max(0, rect.top - vp.top - DROPDOWN_GAP)

  // Below unless below is cramped AND above is genuinely roomier. A tie
  // stays below — that is where a person's eye already is.
  const goBelow = roomBelow >= Math.min(DROPDOWN_MAX_HEIGHT, DROPDOWN_MIN_USEFUL) || roomBelow >= roomAbove

  const room = goBelow ? roomBelow : roomAbove
  // Never 0: a panel with no height is a panel that "returned nothing".
  // If the screen is that cramped the list overflows and scrolls — still
  // better than an empty box.
  const maxHeight = clamp(Math.floor(room), DROPDOWN_MIN_USEFUL / 2, DROPDOWN_MAX_HEIGHT)

  const left = Math.max(0, rect.left)
  const maxWidth = clamp(vp.width - left - EDGE_INSET, Math.min(rect.width, DROPDOWN_MAX_WIDTH), DROPDOWN_MAX_WIDTH)
  const base = { left, minWidth: Math.min(rect.width, maxWidth), maxWidth, maxHeight }

  if (goBelow) return { placement: 'below', top: rect.bottom + DROPDOWN_GAP, ...base }
  return { placement: 'above', bottom: vp.layoutHeight - rect.top + DROPDOWN_GAP, ...base }
}

/** Read the visible region off the window. The visual viewport is what a
 *  keyboard shrinks; where the API is missing the layout viewport is all
 *  there is. */
export function readVisibleViewport(win: Window): VisibleViewport {
  const vv = win.visualViewport
  return {
    top: vv?.offsetTop ?? 0,
    height: vv?.height ?? win.innerHeight,
    width: vv?.width ?? win.innerWidth,
    layoutHeight: win.innerHeight,
  }
}
