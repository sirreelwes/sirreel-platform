/**
 * The add-a-line menu on the check in/out sheet has to be READABLE.
 *
 *   npx tsx tests/warehouse/menu-placement.test.ts
 *   npm run test:menu-placement
 *
 * Pure + offline: no DB, no DOM, no env.
 *
 * Pins the arithmetic behind Oliver's complaint, twice (2026-09-16 and
 * 2026-09-17): "the dropdown box can't be seen fully, which makes it
 * harder for warehouse to add items during checkout." The regression
 * that matters is a FIXED height — a menu that always asks for 240px is
 * cut off whenever neither side has 240px, which is the ordinary case
 * on a laptop. Every case below is measured off the real geometry: the
 * staff shell's <main> is the clipping edge, not the window.
 */

import {
  placeMenu,
  MENU_IDEAL_PX,
  MENU_MIN_PX,
  MENU_GAP_PX,
  MENU_EDGE_PX,
} from '../../src/lib/warehouse/menuPlacement'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

const PAD = MENU_GAP_PX + MENU_EDGE_PX

/** A 32px field sitting `below` px off the bottom of an 800px shell. */
const field = (top: number, boundsBottom = 800, boundsTop = 0) =>
  ({ fieldTop: top, fieldBottom: top + 32, boundsTop, boundsBottom })

console.log('the ordinary case — room below, opens down at full height')
{
  const p = placeMenu(field(200))
  check('opens downward', !p.up)
  check('takes the ideal height', p.maxHeight === MENU_IDEAL_PX)
  check('does not ask to be scrolled', !p.nudge)
}

console.log('near the bottom of the sheet — flips up')
{
  // 100px below, ~600px above: below cannot hold it, above easily can.
  const p = placeMenu(field(668))
  check('opens upward', p.up)
  check('and at full height, because there is room up there', p.maxHeight === MENU_IDEAL_PX)
  check('no nudge needed', !p.nudge)
}

console.log('THE REGRESSION — neither side has the ideal 240px')
{
  // A short viewport: 180px below, 200px above. A fixed-height menu is
  // cut off whichever way it opens; this one shortens to fit.
  const p = placeMenu(field(200 + PAD, 200 + PAD + 32 + 180 + PAD, 0))
  check('picks the roomier side — up', p.up)
  check('is SHORTER than the ideal, not cut off', p.maxHeight < MENU_IDEAL_PX)
  check('takes the room that is really there (200px)', p.maxHeight === 200)
  check('still worth opening in place', !p.nudge)
}

console.log('flipping up must BUY room, not just move the problem')
{
  // 160px below but only 60px above — down is the roomier side, even
  // though down cannot hold the full menu either.
  const p = placeMenu(field(60 + PAD, 60 + PAD + 32 + 160 + PAD, 0))
  check('stays downward when above is tighter', !p.up)
  check('sized to the 160px below', p.maxHeight === 160)
  check('and opens in place', !p.nudge)
}
{
  // 100px below, 60px above. Down is still the roomier side, but 100px
  // is under the readable minimum — so this is a nudge, NOT a 100px
  // sliver. The distinction is the whole point of MENU_MIN_PX.
  const p = placeMenu(field(60 + PAD, 60 + PAD + 32 + 100 + PAD, 0))
  check('a sub-minimum best side asks for a nudge instead', p.nudge)
  check('and never reports the sliver height', p.maxHeight === MENU_MIN_PX)
}

console.log('jammed against an edge — ask to be scrolled, never render a sliver')
{
  // 40px below, 40px above: nothing readable fits either way.
  const p = placeMenu(field(40 + PAD, 40 + PAD + 32 + 40 + PAD, 0))
  check('asks for a nudge', p.nudge)
  check('never reports a height under the minimum', p.maxHeight >= MENU_MIN_PX)
}
{
  // The field is scrolled clean out of the top of the container.
  const p = placeMenu({ fieldTop: -50, fieldBottom: -18, boundsTop: 0, boundsBottom: 800 })
  check('a field above the fold still resolves, downward', !p.nudge && !p.up)
}

console.log('the clipping edge is the SHELL, not the window')
{
  // The same field on the same screen, measured two ways. Against the
  // window (0..800) there is room for the full menu. Against the shell
  // that really clips it (250..500 — <main> is `overflow-y-auto`) there
  // is not, and measuring the window instead is what puts a menu under
  // an edge the user can see.
  const window_ = placeMenu(field(300, 800, 0))
  const shell = placeMenu(field(300, 500, 250))
  check('measured against the window, it takes the full menu', window_.maxHeight === MENU_IDEAL_PX)
  check('measured against the shell, it is shorter', shell.maxHeight < window_.maxHeight)
  check('and exactly the room the shell leaves', shell.maxHeight === 500 - 332 - PAD)
  // Both open downward here — the difference the shell makes is the
  // HEIGHT, which is exactly the half a naive fix leaves out.
  check('both still open downward', !window_.up && !shell.up)
}

console.log('the boundary itself')
{
  // Exactly the ideal below — must not flip.
  const exact = placeMenu(field(100, 100 + 32 + MENU_IDEAL_PX + PAD))
  check('exactly enough below stays downward', !exact.up)
  check('at the ideal height', exact.maxHeight === MENU_IDEAL_PX)
  // One pixel short — flips, since above is roomier.
  const short = placeMenu(field(400, 400 + 32 + MENU_IDEAL_PX + PAD - 1))
  check('one pixel short flips up', short.up)
}

console.log('a height is never negative or fractional')
{
  for (const top of [0, 1, 37, 199, 401, 799]) {
    const p = placeMenu(field(top))
    if (!Number.isInteger(p.maxHeight) || p.maxHeight < MENU_MIN_PX) {
      failures.push(`height is a sane integer at top=${top} (got ${p.maxHeight})`)
    }
  }
  check('every position gives a whole pixel count at or above the minimum', true)
}

if (failures.length) {
  console.error(`\n${failures.length} failed:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\nall good')
