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

/* Types + pure helpers live in markupShared.ts (client-safe); this
 * module holds the server-only PDF engine (pdfjs + native canvas) and
 * re-exports the shared surface for existing server-side importers. */
export * from './markupShared'
import { type InsertedNote, type MarkupManifest, type StruckSpan, type UnmappedGraphic } from './markupShared'

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
 * pdfjs loader shared by all three engine entry points. Pins the
 * fake-worker path to the traced node_modules file when it exists
 * (Vercel lambda: /var/task/node_modules/…) — pdfjs otherwise resolves
 * pdf.worker.mjs relative to pdf.mjs at runtime, an import nft can't
 * see, which is how the worker went missing from the serverless bundle.
 * Works together with next.config's outputFileTracingIncludes.
 */
/** Words whose center falls inside ANY of the quads (±tolerance). */
function wordsInQuads(
  quads: Array<{ x0: number; y0: number; x1: number; y1: number }>,
  words: Word[],
): Word[] {
  const hit: Word[] = []
  for (const q of quads) {
    for (const w of words) {
      const wcx = (w.x0 + w.x1) / 2
      const wcy = w.y + w.h / 2
      if (wcx > q.x0 - 1 && wcx < q.x1 + 1 && wcy > q.y0 - 3 && wcy < q.y1 + 3) hit.push(w)
    }
  }
  return hit
}

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  try {
    const path = await import('node:path')
    const fs = await import('node:fs')
    const candidate = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')
    if (fs.existsSync(candidate) && pdfjs.GlobalWorkerOptions) {
      pdfjs.GlobalWorkerOptions.workerSrc = candidate
    }
  } catch {
    // Non-Node runtime — pdfjs's default resolution applies.
  }
  return pdfjs
}

/**
 * Build the manifest from a PDF buffer. pdfjs-dist is imported
 * dynamically so this module's types/helpers stay importable from
 * client components without dragging the PDF engine into the bundle.
 */
export async function buildAnnotationManifest(pdf: Buffer | Uint8Array): Promise<MarkupManifest> {
  const pdfjs = await loadPdfjs()
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
    // iOS Quartz (AppendMode) markup carries a /Popup companion per
    // annotation, and pdfjs surfaces that popup AS A SECOND annotation
    // wearing the parent's subtype (observed: StrikeOut 46R + clone
    // 47R with identical quads, where 47R is 46R's popupRef and its
    // own id — the popup object itself). Skip every annotation whose
    // id is referenced as a popupRef; without this each strike counts
    // twice (Black Dog return: 13 spans instead of the true 7).
    const popupIds = new Set((annots as any[]).map((a) => a.popupRef).filter(Boolean))
    for (const a of annots as any[]) {
      if (a.id && popupIds.has(a.id)) continue
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
        // QuadPoints give exact text-anchored rects — one quad per
        // text line, so a multi-line strike carries several quads.
        // EVERY quad is mapped; the hit set spans them all.
        const hit = wordsInQuads(normalizeQuadPoints(a.quadPoints), words)
        pushStruck(struck, unmapped, pageNo, 'strikeout', hit)
        continue
      }

      if (subtype === 'Underline' || subtype === 'Highlight') {
        // QuadPoint-anchored like StrikeOut, but the semantics are NOT
        // deletion — underline typically marks added/emphasized text,
        // highlight marks attention. Word-mapped and surfaced verbatim
        // (in `unmapped` so nothing ever reads them as a strike).
        const hit = wordsInQuads(normalizeQuadPoints(a.quadPoints), words)
        const text = [...hit].sort((x, y) => y.y - x.y || x.x0 - y.x0).map((w) => w.text).join(' ')
        unmapped.push({
          page: pageNo,
          kind: subtype.toLowerCase(),
          note: text
            ? `${subtype.toLowerCase()}d text (emphasis/possible addition, NOT a deletion): "${text}"`
            : `${subtype} annotation with no text under it`,
        })
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
        // SIGNATURE/INK — initials or signature image. Carries NO text
        // semantics and is NEVER an edit; reported for visual context only.
        unmapped.push({ page: pageNo, kind: 'signature-ink', note: 'SIGNATURE/INK stamp (initials or signature image) — not an edit' })
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

/**
 * TEXT LAYER extraction — one reading-order string per page. This is
 * the first of the three canonical review inputs (text layer,
 * annotation manifest, page images). Throws on failure — the caller
 * must fail loudly, never degrade.
 */
export async function extractPdfTextLayer(pdf: Buffer | Uint8Array): Promise<string[]> {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({
    data: pdf instanceof Buffer ? new Uint8Array(pdf) : pdf,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise
  const pages: string[] = []
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo)
    const tc = await page.getTextContent()
    // Group items into y-lines (PDF origin bottom-left → higher y first).
    const lines: Array<{ y: number; parts: Array<{ x: number; str: string }> }> = []
    for (const item of tc.items as any[]) {
      if (!item.str || !item.str.trim()) continue
      const y: number = item.transform[5]
      const x: number = item.transform[4]
      const line = lines.find((l) => Math.abs(l.y - y) < 3)
      if (line) line.parts.push({ x, str: item.str })
      else lines.push({ y, parts: [{ x, str: item.str }] })
    }
    lines.sort((a, b) => b.y - a.y)
    pages.push(
      lines
        .map((l) => l.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n'),
    )
  }
  await doc.destroy()
  return pages
}

/**
 * VISUAL GROUND TRUTH — rasterize EVERY page to a JPEG via pdfjs +
 * @napi-rs/canvas. Third canonical review input. Throws on any page
 * failure — the caller must fail loudly, never degrade to text-only.
 */
export async function renderPdfPageImages(
  pdf: Buffer | Uint8Array,
  opts: { scale?: number; quality?: number } = {},
): Promise<Array<{ page: number; jpegBase64: string }>> {
  const scale = opts.scale ?? 1.6 // ~115 DPI on US Letter — readable, size-sane
  const quality = opts.quality ?? 80
  const pdfjs = await loadPdfjs()
  const { createCanvas } = await import('@napi-rs/canvas')
  const doc = await pdfjs.getDocument({
    data: pdf instanceof Buffer ? new Uint8Array(pdf) : pdf,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise
  const out: Array<{ page: number; jpegBase64: string }> = []
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo)
    const viewport = page.getViewport({ scale })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx as any, viewport } as any).promise
    out.push({ page: pageNo, jpegBase64: canvas.toBuffer('image/jpeg', quality).toString('base64') })
  }
  await doc.destroy()
  if (out.length === 0) throw new Error('rasterization produced zero pages')
  return out
}

