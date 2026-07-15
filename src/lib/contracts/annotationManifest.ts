/**
 * Deterministic PDF markup extraction for contract review.
 *
 * Origin: review ef015a5a (Black Dog Films). The client's redline was
 * macOS Preview markup — red /Line graphics drawn over text plus
 * /FreeText margin notes. Those annotations NEVER touch the PDF's text
 * layer, so the AI's `proposed` transcription silently retained struck
 * phrases while its visual summary described them as deleted.
 *
 * This module reads the annotation objects themselves and maps strike
 * geometry to the verbatim words underneath, producing a MarkupManifest
 * that (a) is fed to the AI as ground truth, (b) drives a post-AI
 * retained-strike guardrail, and (c) renders next to the AI's output in
 * the review UI so the operator sees both.
 *
 * Handles BOTH proper /StrikeOut text-markup annotations (QuadPoints)
 * and the Preview case: near-horizontal /Line and /Ink graphics.
 * Steep lines (leaders pointing at notes), stamps, and strikes that
 * match no text are reported in `unmapped` rather than guessed at.
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

interface Word {
  x0: number
  x1: number
  /** Baseline y (PDF coords, origin bottom-left). */
  y: number
  h: number
  text: string
  clause: string | null
}

interface TextLine {
  y: number
  words: Word[]
  text: string
}

const HEADING_RE = /^(\d{1,2})\.\s+\S/

/**
 * Build the manifest from a PDF buffer. pdfjs-dist is imported
 * dynamically so this module's types/helpers stay importable from
 * client components without dragging the PDF engine into the bundle.
 */
export async function buildAnnotationManifest(pdf: Buffer | Uint8Array): Promise<MarkupManifest> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({
    data: pdf instanceof Buffer ? new Uint8Array(pdf) : pdf,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise

  const struck: StruckSpan[] = []
  const inserted: InsertedNote[] = []
  const unmapped: UnmappedGraphic[] = []

  // Clause tracking continues across pages — a clause that starts on
  // one page owns text at the top of the next until a new heading.
  let currentClause: string | null = null
  let fleetMode = false

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo)
    const textContent = await page.getTextContent()

    // ── words with boxes ──
    const words: Word[] = []
    for (const item of textContent.items as any[]) {
      const str: string = item.str
      if (!str || !str.trim()) continue
      const x: number = item.transform[4]
      const y: number = item.transform[5]
      const h: number = item.height || Math.hypot(item.transform[1], item.transform[3]) || 10
      const w: number = item.width || 0
      const charW = str.length > 0 ? w / str.length : 0
      // Split the run into words, approximating each word's x-extent by
      // character count — plenty accurate for strike-band mapping.
      const re = /\S+/g
      let m: RegExpExecArray | null
      while ((m = re.exec(str))) {
        words.push({
          x0: x + m.index * charW,
          x1: x + (m.index + m[0].length) * charW,
          y,
          h,
          text: m[0],
          clause: null, // assigned after line assembly
        })
      }
    }

    // ── reading-order lines (PDF origin bottom-left → higher y first) ──
    const lines: TextLine[] = []
    const sorted = [...words].sort((a, b) => b.y - a.y || a.x0 - b.x0)
    for (const w of sorted) {
      const line = lines.find((l) => Math.abs(l.y - w.y) < 3)
      if (line) {
        line.words.push(w)
        line.y = (line.y * (line.words.length - 1) + w.y) / line.words.length
      } else {
        lines.push({ y: w.y, words: [w], text: '' })
      }
    }
    lines.sort((a, b) => b.y - a.y)
    for (const l of lines) {
      l.words.sort((a, b) => a.x0 - b.x0)
      l.text = l.words.map((w) => w.text).join(' ')
      if (/fleet\s+agreement/i.test(l.text)) fleetMode = true
      const hm = l.text.match(HEADING_RE)
      if (hm) currentClause = fleetMode ? `Fleet ${hm[1]}` : hm[1]
      for (const w of l.words) w.clause = currentClause
    }

    // ── annotations ──
    const annots = await page.getAnnotations()
    for (const a of annots as any[]) {
      const subtype: string = a.subtype
      const contents: string =
        (a.contentsObj && typeof a.contentsObj.str === 'string' && a.contentsObj.str) ||
        (typeof a.contents === 'string' && a.contents) ||
        ''

      if (subtype === 'FreeText') {
        const text = contents.trim()
        if (!text) continue
        const cy = (a.rect[1] + a.rect[3]) / 2
        // Anchor the note to the nearest text line's clause.
        let best: TextLine | null = null
        for (const l of lines) {
          if (!best || Math.abs(l.y - cy) < Math.abs(best.y - cy)) best = l
        }
        inserted.push({
          page: pageNo,
          text,
          clauseGuess: best?.words[0]?.clause ?? null,
        })
        continue
      }

      if (subtype === 'StrikeOut') {
        const quads = normalizeQuadPoints(a.quadPoints)
        const hit: Word[] = []
        for (const q of quads) {
          for (const w of words) {
            const wcx = (w.x0 + w.x1) / 2
            const wcy = w.y + w.h / 2
            if (wcx > q.x0 - 1 && wcx < q.x1 + 1 && wcy > q.y0 - 3 && wcy < q.y1 + 3) hit.push(w)
          }
        }
        pushStruck(struck, unmapped, pageNo, 'strikeout', hit)
        continue
      }

      if (subtype === 'Line') {
        const lc: number[] | undefined = a.lineCoordinates
        const [lx0, ly0, lx1, ly1] = lc && lc.length === 4 ? lc : a.rect
        const dx = Math.abs(lx1 - lx0)
        const dy = Math.abs(ly1 - ly0)
        // Steep line = a leader/connector pointing at a note, not a
        // strike. Report it instead of mis-striking whatever it crosses
        // (the ef015a5a leader crossed "is primary").
        if (dy > 12 && dy > dx * 0.45) {
          unmapped.push({ page: pageNo, kind: 'line', note: 'diagonal line (leader/connector) — not treated as a strike' })
          continue
        }
        const yMid = (ly0 + ly1) / 2
        const minX = Math.min(lx0, lx1)
        const maxX = Math.max(lx0, lx1)
        const hit = words.filter(
          (w) => w.x0 < maxX + 1 && w.x1 > minX - 1 && yMid > w.y - 2 && yMid < w.y + w.h,
        )
        pushStruck(struck, unmapped, pageNo, 'line', hit)
        continue
      }

      if (subtype === 'Ink') {
        for (const strokeRaw of a.inkLists || []) {
          const pts = normalizeInkStroke(strokeRaw)
          if (pts.length < 2) continue
          const xs = pts.map((p) => p.x)
          const ys = pts.map((p) => p.y)
          const minX = Math.min(...xs)
          const maxX = Math.max(...xs)
          const minY = Math.min(...ys)
          const maxY = Math.max(...ys)
          if (maxY - minY > 12) {
            unmapped.push({ page: pageNo, kind: 'ink', note: 'tall ink stroke (drawing/leader) — not treated as a strike' })
            continue
          }
          const yMid = (minY + maxY) / 2
          const hit = words.filter(
            (w) => w.x0 < maxX + 1 && w.x1 > minX - 1 && yMid > w.y - 2 && yMid < w.y + w.h,
          )
          pushStruck(struck, unmapped, pageNo, 'ink', hit)
        }
        continue
      }

      if (subtype === 'Stamp') {
        unmapped.push({ page: pageNo, kind: 'stamp', note: 'stamp graphic (signature/initials image) — visual only' })
        continue
      }
      // Widgets, Squares (form boxes), Links etc. carry no redline meaning.
    }
  }

  await doc.destroy()

  return {
    version: 1,
    pages: doc.numPages,
    struck,
    inserted,
    unmapped,
    extractedAt: new Date().toISOString(),
  }
}

function pushStruck(
  struck: StruckSpan[],
  unmapped: UnmappedGraphic[],
  page: number,
  kind: StruckSpan['kind'],
  hit: Word[],
) {
  if (hit.length === 0) {
    unmapped.push({ page, kind, note: 'strike annotation matched no text under it' })
    return
  }
  const ordered = [...hit].sort((a, b) => b.y - a.y || a.x0 - b.x0)
  struck.push({
    page,
    text: ordered.map((w) => w.text).join(' '),
    kind,
    clauseGuess: ordered[0].clause,
  })
}

/** QuadPoints arrive flat (Float32Array, 8 per quad) or as {x,y}[][] depending on pdfjs version. */
function normalizeQuadPoints(qp: any): { x0: number; y0: number; x1: number; y1: number }[] {
  const out: { x0: number; y0: number; x1: number; y1: number }[] = []
  if (!qp) return out
  if (typeof qp[0] === 'number' || qp instanceof Float32Array) {
    for (let i = 0; i + 7 < qp.length; i += 8) {
      const xs = [qp[i], qp[i + 2], qp[i + 4], qp[i + 6]]
      const ys = [qp[i + 1], qp[i + 3], qp[i + 5], qp[i + 7]]
      out.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) })
    }
    return out
  }
  for (const quad of qp) {
    const pts = Array.isArray(quad) ? quad : [quad]
    const xs = pts.map((p: any) => p.x)
    const ys = pts.map((p: any) => p.y)
    out.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) })
  }
  return out
}

/** Ink strokes arrive flat number arrays or {x,y}[] depending on pdfjs version. */
function normalizeInkStroke(stroke: any): { x: number; y: number }[] {
  if (!stroke || stroke.length === 0) return []
  if (typeof stroke[0] === 'number') {
    const pts: { x: number; y: number }[] = []
    for (let i = 0; i + 1 < stroke.length; i += 2) pts.push({ x: stroke[i], y: stroke[i + 1] })
    return pts
  }
  return stroke.map((p: any) => ({ x: p.x, y: p.y }))
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
