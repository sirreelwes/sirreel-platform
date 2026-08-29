/**
 * Shared palette + shading tokens for client-facing PDFs.
 *
 * Quote and Invoice each carried their own private, byte-identical copy
 * of this object. Two copies of a brand palette is one copy too many —
 * the next colour change lands on whichever file the author had open,
 * and a client gets a quote and an invoice that don't look related.
 *
 * The shading language mirrors the RentalWorks documents SirReel has
 * been sending for years (Wes, 2026-08-29): pale tinted blocks behind
 * field labels and section bands, a coloured rule under each band, the
 * document title in the accent, and money cells picked out in a warm
 * tint against the cool ones. Clients already read that layout, so
 * keeping it is continuity, not imitation.
 *
 * The accent is deliberately turquoise-leaning rather than RW's flat
 * corporate blue (Wes: "a little more turquoise"). It stays dark enough
 * to hold contrast as small bold type on white, which the pale fills
 * are not — those are backgrounds only, never text colours.
 */

export const PDF_BRAND = {
  // ── Ink ───────────────────────────────────────────────────────────
  ink: '#111111',
  muted: '#555555',
  faint: '#888888',

  // ── Rules ─────────────────────────────────────────────────────────
  rule: '#cccccc',
  ruleSoft: '#e5e5e5',
  zebra: '#fafafa',

  // ── Accent (turquoise-leaning) ────────────────────────────────────
  /** Document title, section titles, the quote/invoice number. */
  accent: '#0F7A93',
  /** Rules under accent bands — a touch deeper so it reads as a line. */
  accentDeep: '#0B5C70',
  /** Hairlines around tinted blocks. */
  accentEdge: '#8FC2CE',
  /** Pale block fill behind section bands and field labels. */
  accentFill: '#E4F1F4',
  /** Lighter tint for table headers and zebra-alternatives. */
  accentFillSoft: '#F1F8F9',

  /** Warm tint reserved for money cells — the one warm note, so totals
   *  read as the answer rather than as more chrome. */
  moneyFill: '#FCFBE9',

  /** Discounts / warnings. Unchanged — it must NOT read as the accent. */
  amber: '#b45309',
} as const

export type PdfBrand = typeof PDF_BRAND
