/**
 * Code 39 barcode encoder — pure geometry, no rendering dependency.
 *
 * Used by the warehouse Pick List PDF to print a scannable order-number
 * barcode (mirrors the RentalWorks pick list's top-right barcode block).
 * Code 39 because it natively covers our order-number alphabet
 * (A–Z, 0–9, dash) with no check-digit requirement, and every commodity
 * warehouse scanner reads it out of the box.
 *
 * Output is a list of bar rectangles in abstract "units" (narrow bar =
 * 1 unit, wide bar = WIDE_RATIO units); the caller scales to points/px.
 */

// 9 elements per character: 5 bars interleaved with 4 spaces, always
// starting and ending on a bar. 'n' = narrow, 'w' = wide.
const CODE39: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw',
  E: 'wnnnwwnnn', F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn',
  I: 'nnwnnwwnn', J: 'nnnnwwwnn', K: 'wnnnnnnww', L: 'nnwnnnnww',
  M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn',
  Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn', Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
}

const WIDE_RATIO = 2.5

export interface BarcodeBar {
  /** x offset in units from the left edge */
  x: number
  /** bar width in units */
  width: number
}

export interface Code39Geometry {
  bars: BarcodeBar[]
  /** total width in units (bars + inter-character gaps) */
  totalWidth: number
}

/**
 * Encode `value` (uppercased; unsupported characters dropped) with the
 * mandatory start/stop `*` sentinels. Returns bar geometry in units.
 */
export function code39Geometry(value: string): Code39Geometry {
  const chars = value
    .toUpperCase()
    .split('')
    .filter((c) => c in CODE39 && c !== '*')
  const encoded = ['*', ...chars, '*']

  const bars: BarcodeBar[] = []
  let x = 0
  for (let ci = 0; ci < encoded.length; ci++) {
    const pattern = CODE39[encoded[ci]]
    for (let i = 0; i < 9; i++) {
      const width = pattern[i] === 'w' ? WIDE_RATIO : 1
      if (i % 2 === 0) bars.push({ x, width }) // even indices are bars
      x += width
    }
    if (ci < encoded.length - 1) x += 1 // inter-character narrow gap
  }
  return { bars, totalWidth: x }
}
