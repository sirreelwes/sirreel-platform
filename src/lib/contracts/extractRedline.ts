import Anthropic from '@anthropic-ai/sdk'
import { CANONICAL_CLAUSES } from './contractClauses'
import { parseAiJson } from '@/lib/ai/extractJson'
import { REDLINE_EXTRACTION_MODEL } from '@/lib/ai/models'
import {
  buildAnnotationManifest,
  extractPdfTextLayer,
  renderPdfPageImages,
} from './annotationManifest'

/**
 * Read a client redline out of whatever form it arrived in.
 *
 * The portal's upload path assumes an annotated PDF. Most redlines are not
 * that — they are an email that says "Section 5, strike the red and add the
 * green", a screenshot of a marked-up page, a paragraph in a thread. This
 * turns any of those into the thing HQ can actually paper with: for each
 * numbered clause the client touched, the FULL text of that clause as it
 * should finally read.
 *
 * Deliberately NOT a review. It renders no opinion on whether a change is
 * acceptable — runReview.ts does that for PDFs. Here the operator has
 * already decided; the model's only job is to read accurately.
 */

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, fetch: globalThis.fetch as any })

export interface RedlineImage {
  media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  data: string
}

export interface ExtractedAmendment {
  clauseRef: string
  title: string
  proposed: string
  /** One line, in the operator's words, of what actually changed. */
  summary: string
}

export interface ExtractedUnmatched {
  text: string
  why: string
}

export type ExtractResult =
  | { ok: true; amendments: ExtractedAmendment[]; unmatched: ExtractedUnmatched[] }
  | { ok: false; status: number; error: string }

const SYSTEM = `You read contract redlines for SirReel Studio Rentals and return the amended clause text.

You are given SirReel's canonical numbered clauses and a client's redline. The redline may be
an email, a list of edits, a screenshot of a marked-up page, or a mix. It typically describes
changes as strikes and additions ("strike the red and add the green", struck text, colored text).

For EVERY clause the client changed, return the COMPLETE amended clause: the canonical text
verbatim, with the client's strikes removed and their additions inserted in place.

Rules, in order of importance:

1. NEVER summarize a clause. The "proposed" field is the literal contract language that will be
   printed for signature. If you return a description of the change instead of the clause, the
   client is asked to sign a description. Return the whole clause every time, however long.
2. NEVER invent, tidy, modernize or improve anything the client did not change. Every word
   outside their edit must match the canonical text exactly — including punctuation, casing,
   quotation marks, and existing typos or odd numbering. Preserve them.
3. Only include a clause the client actually changed. If they merely commented on one, leave it out.
4. Do not renumber list items. If a strike removes "(iii)" and leaves "(i) (ii) (iv)", return it
   that way — the operator decides whether to tidy it.
5. Match to the canonical clause by SUBSTANCE, not just by the number the client cited. Clients
   cite numbers from their own copy and are sometimes off by one. If the quoted language matches
   a different numbered clause, use the clause whose text matches, and say so in the summary.
6. Anything you cannot confidently map to one numbered clause goes in "unmatched" — a rationale
   the client wrote, a request that isn't a clause edit, a change to a document we don't have.
   Never force it into a clause.

Return ONLY a JSON object:

{
  "amendments": [
    { "clauseRef": "5", "proposed": "<the complete amended clause>", "summary": "<one line: what changed>" }
  ],
  "unmatched": [
    { "text": "<what they wrote>", "why": "<why it isn't a clause edit>" }
  ]
}`

/** Pages of a dropped PDF we rasterize. Beyond this the redline is a whole
 *  re-drafted agreement, which belongs in the full contract-review tool. */
const MAX_PDF_PAGES = 12

/**
 * Turn a dropped PDF into the same three inputs the full review pipeline
 * uses: the text layer, the deterministic strike/insert manifest, and page
 * images. The manifest matters most — a PDF strike annotation never touches
 * the text layer, so without it the struck words read as still present.
 */
async function readPdf(pdf: Buffer): Promise<{ images: RedlineImage[]; notes: string }> {
  const [pages, textLayer, manifest] = await Promise.all([
    renderPdfPageImages(pdf),
    extractPdfTextLayer(pdf).catch(() => [] as string[]),
    buildAnnotationManifest(pdf).catch(() => null),
  ])
  const images: RedlineImage[] = pages
    .slice(0, MAX_PDF_PAGES)
    .map((p) => ({ media_type: 'image/jpeg' as const, data: p.jpegBase64 }))

  const struck = manifest?.struck ?? []
  const inserted = manifest?.inserted ?? []
  const notes = [
    textLayer.length
      ? `=== PDF TEXT LAYER (what the words say — NOTE: struck text still appears here) ===\n${textLayer.join('\n\n').slice(0, 60_000)}`
      : '',
    struck.length
      ? `=== STRUCK IN THE PDF (deterministic, from the annotations — REMOVE these) ===\n${struck.map((x: any) => `- ${x.text ?? x}`).join('\n')}`
      : '',
    inserted.length
      ? `=== INSERTED IN THE PDF (deterministic, client's added text — KEEP these) ===\n${inserted.map((x: any) => `- ${x.text ?? x}`).join('\n')}`
      : '',
    pages.length > MAX_PDF_PAGES
      ? `(Only the first ${MAX_PDF_PAGES} of ${pages.length} pages were rendered.)`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  return { images, notes }
}

export async function extractRedline(args: {
  text?: string
  images?: RedlineImage[]
  /** A dropped redline PDF, raw bytes. */
  pdf?: Buffer
}): Promise<ExtractResult> {
  let text = (args.text ?? '').trim()
  let images = args.images ?? []

  if (args.pdf) {
    try {
      const read = await readPdf(args.pdf)
      images = [...images, ...read.images]
      text = [text, read.notes].filter(Boolean).join('\n\n')
    } catch (err) {
      console.error('[extract-redline] pdf read failed:', err)
      return {
        ok: false,
        status: 422,
        error: 'That PDF could not be read. Drop a screenshot of the marked-up pages instead.',
      }
    }
  }

  if (!text && images.length === 0) {
    return { ok: false, status: 400, error: 'Nothing to read — paste the redline, or drop the file.' }
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, status: 500, error: 'AI is not configured on this environment.' }
  }

  const clauseBook = CANONICAL_CLAUSES.map((c) => ({ ref: c.ref, title: c.title, body: c.body }))

  const content: Anthropic.MessageParam['content'] = [
    {
      type: 'text',
      text:
        '=== SIRREEL CANONICAL CLAUSES (the standard agreement) ===\n' +
        JSON.stringify(clauseBook, null, 1),
    },
    ...images.map(
      (img) =>
        ({
          type: 'image',
          source: { type: 'base64', media_type: img.media_type, data: img.data },
        }) as const,
    ),
    {
      type: 'text',
      text:
        '=== THE CLIENT REDLINE ===\n' +
        (text || '(the redline is in the image(s) above)') +
        '\n\nReturn the JSON described in the system prompt.',
    },
  ]

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: REDLINE_EXTRACTION_MODEL,
      // Whole clauses, several of them, verbatim. The failure mode of a low
      // ceiling here is a clause truncated mid-sentence, which parseAiJson
      // catches as a max_tokens stop rather than silently shipping.
      max_tokens: 16000,
      // No `thinking` param: the pinned SDK (0.39) predates adaptive
      // thinking's types, and Opus 5 runs adaptive by default anyway.
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    })
  } catch (err: any) {
    console.error('[extract-redline] api error:', err?.message || err)
    return { ok: false, status: 502, error: 'Could not reach the AI. Try again, or type the clauses in by hand.' }
  }

  const raw = response.content.find((b) => b.type === 'text')
  const out = raw && raw.type === 'text' ? raw.text : ''

  let parsed: { amendments?: unknown; unmatched?: unknown }
  try {
    parsed = parseAiJson(out, { tag: 'extract-redline', stopReason: response.stop_reason })
  } catch {
    return { ok: false, status: 502, error: 'The AI response could not be read. Try again, or type the clauses in by hand.' }
  }

  const byRef = new Map(CANONICAL_CLAUSES.map((c) => [c.ref, c]))
  const amendments: ExtractedAmendment[] = []
  const unmatched: ExtractedUnmatched[] = Array.isArray(parsed.unmatched)
    ? (parsed.unmatched as any[])
        .map((u) => ({ text: String(u?.text ?? '').trim(), why: String(u?.why ?? '').trim() }))
        .filter((u) => u.text)
    : []

  const seen = new Set<string>()
  for (const a of Array.isArray(parsed.amendments) ? (parsed.amendments as any[]) : []) {
    const ref = String(a?.clauseRef ?? '').trim()
    const proposed = String(a?.proposed ?? '').trim()
    const summary = String(a?.summary ?? '').trim()
    const canonical = byRef.get(ref)

    // Everything below fails the amendment INTO the unmatched list rather than
    // dropping it. A change the operator never sees is worse than one they have
    // to key in themselves — silence reads as "the client changed nothing else".
    if (!canonical) {
      unmatched.push({ text: summary || proposed.slice(0, 300), why: `Cited clause "${ref}" is not a numbered clause in our agreement.` })
      continue
    }
    if (seen.has(ref)) {
      unmatched.push({ text: summary || proposed.slice(0, 300), why: `A second edit to clause ${ref} — fold it into the first by hand.` })
      continue
    }
    if (proposed === canonical.body) {
      unmatched.push({ text: summary || `Clause ${ref}`, why: `Clause ${ref} came back identical to our standard text — no change to make.` })
      continue
    }
    // The same floor the renderer enforces: below it, an ACCEPT silently
    // prints the BASELINE clause instead (ContractDocument.resolveClause).
    if (proposed.length < 80 || proposed.length < canonical.body.length * 0.5) {
      unmatched.push({
        text: proposed.slice(0, 300),
        why: `Clause ${ref} came back as a summary, not the full clause — key this one in by hand.`,
      })
      continue
    }
    seen.add(ref)
    amendments.push({ clauseRef: ref, title: canonical.title, proposed, summary })
  }

  // Keep clause order human: 5 before 8 before 14.
  const order = new Map(CANONICAL_CLAUSES.map((c, i) => [c.ref, i]))
  amendments.sort((a, b) => (order.get(a.clauseRef) ?? 0) - (order.get(b.clauseRef) ?? 0))

  return { ok: true, amendments, unmatched }
}
