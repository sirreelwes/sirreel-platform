import { Font } from '@react-pdf/renderer'

/**
 * The ONE hyphenation policy for every @react-pdf document (quotes,
 * invoices, RW invoice mirror, signed agreements).
 *
 * WHY one module: Font.registerHyphenationCallback is GLOBAL to the
 * process — the last registration wins for EVERY document rendered
 * afterward. Until 2026-08-23, QuoteDocument registered a smart
 * callback and InvoiceDocument registered `(word) => [word]` (never
 * break), so which behavior a given render got depended on module
 * load order. Symptom Wes caught on quote S260822-001: the item code
 * overprinting the DESCRIPTION column. Every react-pdf document must
 * import this module (side-effect import) and register NOTHING itself.
 *
 * The policy:
 *  - Real words stay atomic — no mid-word hyphenation ("Productions"
 *    never renders "Produc-tions"; the engine's default hyphenation
 *    looks broken on client-facing paper).
 *  - Inventory-code-shaped tokens — long, ALL-CAPS letters / digits /
 *    hyphens / UNDERSCORES (both code conventions exist:
 *    "TEN-CARAVAN-CANOPY-10X10" and "CAT_CARGO_VAN_LIFTGATE") — fold
 *    at their existing separator boundaries, keeping the separator as
 *    the trailing glyph of each part so the wrapped lines read as the
 *    original code. Codes with no separators fold per-character as a
 *    last resort rather than overflowing the column.
 *  - There is NO length gate on separator folding. The callback only
 *    lists the places a word MAY break; the engine breaks only when the
 *    word does not fit, so "CAT_VAN" stays whole and a code that outruns
 *    the column folds. Until 2026-09-12 folding was gated on
 *    `length > 14`, and "CAT_CUBE_TRUCK" — exactly 14 glyphs, ~11 wider
 *    than the pick list's 12% code column — printed straight over
 *    "SuperCube Truck" (order S260902-008). The gate stays only for
 *    separator-less runs, where the break points are arbitrary.
 */
const MAX_PART = 8 // longest un-splittable run — keeps every part inside the narrowest (11%) code column
const CODE_SHAPE = /^[A-Z0-9_-]+$/
const SEPARATOR = /[-_]/

function chunk(part: string): string[] {
  if (part.length <= MAX_PART) return [part]
  const out: string[] = []
  for (let i = 0; i < part.length; i += MAX_PART) out.push(part.slice(i, i + MAX_PART))
  return out
}

/** Pure policy — exported so the test can pin it without rendering a PDF. */
export function hyphenateWord(word: string): string[] {
  if (!CODE_SHAPE.test(word)) return [word]
  if (SEPARATOR.test(word)) {
    // A single segment can still outrun the column ("SUPERCUBE_" is 10
    // glyphs) — chunk anything longer than MAX_PART so no part can
    // touch the neighboring column.
    // Break after a separator run, not inside it: "VEH--STRAPS--RATCHET"
    // is VEH-- / STRAPS-- / RATCHET, never a lone "-" starting a line.
    return word.split(/(?<=[-_])(?![-_])/).flatMap(chunk)
  }
  if (word.length > 14) return chunk(word)
  return [word]
}

Font.registerHyphenationCallback(hyphenateWord)

/** Import target so the side-effect import is explicit at call sites. */
export const pdfHyphenationRegistered = true
