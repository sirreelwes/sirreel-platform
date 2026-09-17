/**
 * The combobox dropdown against the part of the screen a person can see
 * (2026-09-17 — a phone in landscape with the keyboard up).
 *
 * Run: npm run test:dropdown-placement
 */
import { placeDropdown, DROPDOWN_MAX_HEIGHT, DROPDOWN_GAP, DROPDOWN_MAX_WIDTH } from '@/lib/ui/dropdownPlacement'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const yes = (label: string, cond: boolean) => eq(label, cond, true)

// A desktop: 1440×900, nothing covering it, input a third of the way down.
const desktop = { top: 0, height: 900, width: 1440, layoutHeight: 900 }
const d = placeDropdown({ top: 300, bottom: 334, left: 200, width: 400 }, desktop)
eq('desktop: below', d.placement, 'below')
eq('desktop: pinned under the input', d.top, 334 + DROPDOWN_GAP)
eq('desktop: full height', d.maxHeight, DROPDOWN_MAX_HEIGHT)
eq('desktop: full width', d.maxWidth, DROPDOWN_MAX_WIDTH)
eq('desktop: at least the input wide', d.minWidth, 400)

// An iPhone sideways: 812×375 layout. Keyboard up → the visible strip is
// ~170px tall and the browser has scrolled so the input sits at its bottom.
// This is Wes's case: the list used to pin BELOW the input, under the keys.
const landscapeKeyboard = { top: 0, height: 170, width: 812, layoutHeight: 375 }
const l = placeDropdown({ top: 120, bottom: 154, left: 24, width: 500 }, landscapeKeyboard)
eq('landscape+keyboard: flips above', l.placement, 'above')
eq('landscape+keyboard: anchored by bottom, flush to the field', l.bottom, 375 - 120 + DROPDOWN_GAP)
yes('landscape+keyboard: no taller than the room above', l.maxHeight <= 120 - DROPDOWN_GAP)
yes('landscape+keyboard: still tall enough to read', l.maxHeight >= 60)
eq('landscape+keyboard: top unset', l.top, undefined)

// Same phone, page scrolled so the visible strip is offset from the top
// (visualViewport.offsetTop > 0). Room is measured from the strip's edges,
// not the layout viewport's.
const scrolled = { top: 200, height: 170, width: 812, layoutHeight: 375 }
const s = placeDropdown({ top: 330, bottom: 364, left: 24, width: 500 }, scrolled)
eq('scrolled strip: above', s.placement, 'above')
yes('scrolled strip: room measured from the strip top', s.maxHeight <= 330 - 200 - DROPDOWN_GAP)

// Input near the TOP of a short strip: below has the room, above has none.
const t = placeDropdown({ top: 10, bottom: 44, left: 24, width: 500 }, landscapeKeyboard)
eq('input at the top: below', t.placement, 'below')
yes('input at the top: fits the strip', t.maxHeight <= 170 - 44 - DROPDOWN_GAP)

// Portrait phone, no keyboard: 375×667, input mid-page, plenty below.
const portrait = { top: 0, height: 667, width: 375, layoutHeight: 667 }
const p = placeDropdown({ top: 300, bottom: 334, left: 16, width: 343 }, portrait)
eq('portrait: below', p.placement, 'below')
eq('portrait: never wider than the screen', p.maxWidth, 375 - 16 - 8)
eq('portrait: min width follows', p.minWidth, 343)

// Cramped both ways: a tie or near-tie stays below (the eye is there).
const cramped = { top: 0, height: 100, width: 375, layoutHeight: 667 }
const c = placeDropdown({ top: 40, bottom: 60, left: 16, width: 343 }, cramped)
eq('cramped, more room below: below', c.placement, 'below')
yes('cramped: never a zero-height panel', c.maxHeight >= 60)

if (fail) { console.error(`\n${fail} failing`); process.exit(1) }
console.log('\nall good')
