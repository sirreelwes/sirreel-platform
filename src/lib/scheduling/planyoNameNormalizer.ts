/**
 * Normalize a Planyo `unit_assignment` string to the form expected
 * by `Asset.unitName`. Built for Chunk 7.5 of the native-scheduling
 * rollout — closes the systematic name-format gap between Planyo
 * unit names and prod Asset.unitName values.
 *
 * Transformations (in order):
 *   1. Detect & strip the `(2ND HOLD)` annotation Planyo uses to
 *      stack a backup hold on the same unit. The caller decides
 *      whether to skip backup-hold reservations entirely — we just
 *      surface the flag and remove the marker from the name.
 *   2. Strip a leading `A - ` / `B - ` etc. slot indicator (e.g.,
 *      "A - Standing Sets" → "Standing Sets").
 *   3. Strip all parenthetical annotations (`(A)`, `(Mid Roof)`,
 *      `(12 Pass)`, `(Nissan)`, `(Cargo Space)`, `(2Room)`,
 *      `(w/ MiFi)`, `(No MiFi)`, …).
 *   4. Strip `#` punctuation.
 *   5. Strip leading "Super " (Cargo-specific; Planyo writes
 *      "Super Cargo #N", DB stores "Cargo N").
 *   6. Collapse whitespace.
 *   7. Apply a category-specific short-prefix transformation:
 *        - Bare digit → prepend the short prefix.
 *        - Starts with the long category name (e.g.,
 *          "Camera Cube 1") → swap to short prefix ("Cam 1").
 *        - Anything else (e.g., "Sprinter 1") passes through
 *          unchanged; if no Asset exists with that name, the
 *          caller logs it as a genuinely missing Asset rather
 *          than guessing.
 *
 * Pure function — no I/O.
 */

/**
 * Cross-category unit overrides — Planyo's categorization is stale for
 * these units: it files them under "Cargo Vans w/o Liftgate" but the
 * physical vans live in HQ's "Cargo Van w/ Liftgate" category. Ruling
 * by Wes 2026-07-15: bind to the HQ w/-Liftgate assets. Keyed by
 * NORMALIZED unit name; consulted ONLY after a zero-match in the
 * reservation's own resolved category (Cargo 22/25 exist in w/o and
 * resolve normally — deliberately absent here). Applies to both the
 * ongoing importer and the backfill binder. Dies at Planyo cutover.
 */
export const PLANYO_UNIT_CATEGORY_OVERRIDES: Record<string, string> = {
  'Cargo 20': 'Cargo Van w/ Liftgate',
  'Cargo 21': 'Cargo Van w/ Liftgate',
  'Cargo 23': 'Cargo Van w/ Liftgate',
  'Cargo 24': 'Cargo Van w/ Liftgate',
}

const CATEGORY_TO_SHORT: Record<string, string> = {
  'Cube Truck': 'Cube',
  // 2026-07 rename: the HQ category "Cube Truck" became "SuperCube
  // Truck" (assets stayed "Cube N"). Keep BOTH keys — Planyo-side
  // strings and older callers still say "Cube Truck".
  'SuperCube Truck': 'Cube',
  'Cargo Van w/ Liftgate': 'Cargo',
  'Cargo Van w/o Liftgate': 'Cargo',
  'Passenger Van': 'Pass',
  // HQ category name is one-word "PopVan"; Planyo has been observed
  // (and will continue) to surface the two-word "Pop Van" spelling
  // for the same resource. Mapping BOTH spellings to "Pop" here so
  // that callers passing either form get the same short-prefix
  // behavior. Add new spellings here whenever a Planyo schema drift
  // re-introduces unmatched Pop units.
  PopVan: 'Pop',
  'Pop Van': 'Pop',
  'Camera Cube': 'Cam',
  DLUX: 'DLUX',
  // Studios and ProScout / VTR are not number-prefixed in
  // Asset.unitName — leave their names as-is and rely on direct
  // string match.
}

// Allow "(2ND HOLD)", "(2ND Hold)", AND the rare paren-less
// "X - 2ND HOLD" / "Cube 18 2ND HOLD" form Planyo also uses.
const BACKUP_HOLD_RE = /\(?\s*\b2ND\s+HOLD\b\s*\)?/i
const PAREN_ANNOT_RE = /\([^)]*\)/g
const SLOT_PREFIX_RE = /^[A-Z]\s*-\s*/i
// Planyo's other slot-indicator form: a bare single capital letter at
// the END of the name (e.g., "8 (Mid Roof) A", "9 (Mid Roof) A").
// Symmetric to the leading "A - " — Planyo uses both. Multi-letter
// trailing words (e.g., "Cube 30 Wardrobe") are NOT stripped; they're
// flagged for the operator instead.
const SLOT_TRAILING_RE = /\s+[A-Z]\s*$/
const HASH_RE = /#/g
const SUPER_RE = /\bSuper\s+/gi

export interface NormalizedPlanyoName {
  /** The candidate Asset.unitName to look up. */
  normalized: string
  /** True iff the original Planyo name carried the "(2ND HOLD)" tag. */
  isBackupHold: boolean
}

export function normalizePlanyoUnitName(planyoUnit: string, categoryName: string): NormalizedPlanyoName {
  const original = planyoUnit ?? ''
  const isBackupHold = BACKUP_HOLD_RE.test(original)
  let s = original
  s = s.replace(BACKUP_HOLD_RE, ' ') // remove first so other parens don't double-strip the marker
  s = s.replace(SLOT_PREFIX_RE, '')
  s = s.replace(PAREN_ANNOT_RE, ' ')
  s = s.replace(HASH_RE, ' ')
  s = s.replace(SUPER_RE, '')
  s = s.trim().replace(/\s+/g, ' ')
  // Strip trailing slot-letter AFTER whitespace normalization so it
  // reliably matches against single-letter tokens — "8 (Mid Roof) A"
  // arrives here as "8 A", and we want to strip that " A".
  s = s.replace(SLOT_TRAILING_RE, '').trim()

  const shortPrefix = CATEGORY_TO_SHORT[categoryName]
  if (shortPrefix) {
    // Starts with a digit (pure number OR digit + trailing
    // annotations like "30 Wardrobe" / "8 A"). Prepend the short
    // category prefix. Trailing annotations stay attached so the
    // caller's exact-match lookup either finds a real Asset that
    // happens to carry that suffix, or falls through to the
    // unmatched-units report for manual review.
    if (/^\d/.test(s)) {
      s = `${shortPrefix} ${s}`
    } else {
      const longLower = categoryName.toLowerCase()
      const sLower = s.toLowerCase()
      if (sLower.startsWith(longLower + ' ')) {
        s = `${shortPrefix} ${s.slice(categoryName.length + 1)}`
      }
    }
  }

  return { normalized: s, isBackupHold }
}
