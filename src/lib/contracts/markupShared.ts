/**
 * Client-safe markup types + pure helpers, split from
 * annotationManifest.ts so client components (ReviewResultPanel) can
 * import them WITHOUT dragging the pdfjs/@napi-rs/canvas PDF engine
 * into the browser bundle (native .node modules cannot be bundled).
 */

export interface StruckSpan {
  page: number
  /** Verbatim words physically under the strike, reading order. */
  text: string
  kind: 'strikeout' | 'line' | 'ink'
  /** Best-effort clause the strike falls in (e.g. "7", "Fleet 4"), null when unanchored. */
  clauseGuess: string | null
}

export interface InsertedNote {
  page: number
  text: string
  clauseGuess: string | null
}

export interface UnmappedGraphic {
  page: number
  kind: string
  note: string
}

export interface MarkupManifest {
  version: 1
  pages: number
  struck: StruckSpan[]
  inserted: InsertedNote[]
  unmapped: UnmappedGraphic[]
  extractedAt: string
}


/** True when the manifest carries any redline signal worth acting on. */
export function manifestHasMarkup(m: MarkupManifest | null | undefined): boolean {
  return !!m && (m.struck.length > 0 || m.inserted.length > 0)
}

/**
 * Loose clause matching between a manifest clauseGuess and the AI's
 * `clause` ref (which can be "7", a grouping "1-3", or "Fleet 4(b)").
 */
export function clauseMatches(guess: string | null, changeRef: string | null | undefined): boolean {
  if (!guess || !changeRef) return false
  const g = guess.trim().toLowerCase()
  const r = String(changeRef).trim().toLowerCase()
  if (g === r) return true
  // "Fleet 4" vs "Fleet 4(b)"
  if (r.startsWith(g) || g.startsWith(r)) return true
  // numeric guess inside a grouped ref like "1-3"
  const gn = Number(g)
  const range = r.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/)
  if (Number.isInteger(gn) && range) {
    return gn >= Number(range[1]) && gn <= Number(range[2])
  }
  return false
}

/** Whitespace/quote/punctuation-tolerant normalization for containment checks. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9$&'" ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The ground-truth content block inserted into the AI call. Kept
 * separate from the system prompt so re-runs on annotation-free PDFs
 * add nothing.
 */
export function formatManifestForPrompt(m: MarkupManifest): string {
  if (!manifestHasMarkup(m)) return ''
  const lines: string[] = [
    '=== ANNOTATION GROUND TRUTH (deterministic extraction from the PDF annotation objects) ===',
    '',
    "The client's redline lives in PDF annotations that do NOT alter the text layer — the plain text you read still contains every struck word. The list below was extracted programmatically by mapping each strike annotation's geometry to the words physically under it. Treat it as authoritative over the text layer.",
    '',
  ]
  if (m.struck.length > 0) {
    lines.push('PHYSICALLY STRUCK TEXT — the client deleted these exact spans. `proposed` for the affected clause MUST NOT contain them (write the surviving clause text after the deletion):')
    for (const s of m.struck) {
      lines.push(`- page ${s.page}${s.clauseGuess ? ` (clause ${s.clauseGuess})` : ''}: "${s.text}"`)
    }
    lines.push('')
  }
  if (m.inserted.length > 0) {
    lines.push("CLIENT-INSERTED NOTES (FreeText annotations — includes handwritten-style margin notes AND form-field fill-ins like names/addresses; use judgment on which are redline changes). Where a note modifies a clause, reflect it in that clause's `proposed` and discuss it in `reasoning`:")
    for (const n of m.inserted) {
      lines.push(`- page ${n.page}${n.clauseGuess ? ` (near clause ${n.clauseGuess})` : ''}: "${n.text}"`)
    }
    lines.push('')
  }
  if (m.unmapped.length > 0) {
    lines.push(`UNMAPPED GRAPHICS (${m.unmapped.length}): ${m.unmapped.map((u) => `p${u.page} ${u.kind} (${u.note})`).join('; ')}. These carry no extracted text — check them visually.`)
    lines.push('')
  }
  lines.push('=== END ANNOTATION GROUND TRUTH ===')
  return lines.join('\n')
}
