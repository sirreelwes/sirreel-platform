/**
 * Read a photo of a marked-up pick list.
 *
 * Wes, 2026-09-03: "it would be really cool if they could just take a
 * photo of the pick list and have it be so that it is easy for HQ to
 * ingest for the Check in or out."
 *
 * What this is and is not. It is a TYPING ASSISTANT: it reads the
 * handwriting on a sheet HQ printed, and pre-fills the check report so a
 * supervisor confirms 40 lines instead of typing them. It is NOT an
 * ingestion pipeline — nothing it returns is written anywhere until a
 * person reviews it and hits File. That boundary is deliberate and
 * load-bearing: a misread digit here would rewrite a client's order and
 * email them a corrected quote, so a human sits between the model and
 * the money, always.
 *
 * The read is anchored, not open-ended. We already know exactly what was
 * printed — same order, same line list, same sequence — so the prompt
 * hands the model the printed lines by INDEX and asks only "what did
 * someone write next to each one". That turns a hard transcription
 * problem into a much easier one, and it means a line the model cannot
 * find simply comes back untouched rather than invented.
 */

import Anthropic from '@anthropic-ai/sdk'
import { REVIEW_MODEL } from '@/lib/ai/models'
import { parseAiJson } from '@/lib/ai/extractJson'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface PrintedLine {
  /** 1-based index as printed. The model refers to lines by this. */
  index: number
  orderLineItemId: string
  description: string
  code: string | null
  ordered: number
}

export interface SheetReadLine {
  index: number
  /** What the handwriting says actually went out / came back. */
  actualQty: number
  /** Anything written beside the line — a swap, a reason, a note. */
  note: string | null
  /** The model's own confidence in THIS line, 0-1. */
  confidence: number
}

export interface SheetRead {
  /** Order number read off the printed sheet, for the mismatch check. */
  orderNumber: string | null
  /** Name on the PICKED BY line, if legible. */
  preppedBy: string | null
  lines: SheetReadLine[]
  /** Handwritten rows that are not on the printed list at all. */
  extras: Array<{ description: string; actualQty: number; note: string | null }>
  /** Free-text written elsewhere on the sheet. */
  notes: string | null
  /** Set when the photo simply cannot be read — blurred, cropped, dark. */
  unreadable: string | null
}

function prompt(lines: PrintedLine[], edge: 'OUT' | 'IN'): string {
  const printed = lines
    .map((l) => `${l.index}. [${l.code ?? 'no code'}] ${l.description} — ordered ${l.ordered}`)
    .join('\n')

  return `You are reading a photograph of a SirReel warehouse PICK LIST that a
crew member has filled in by hand. The sheet was printed by our system, so
you already know what is on it. Your ONLY job is to report what a person
wrote on it.

This is the ${edge === 'OUT' ? 'CHECK-OUT (what actually left the building)' : 'CHECK-IN (what actually came back)'} pass.

THE PRINTED LINES, in the order they appear on the page:
${printed}

Return JSON, and nothing else:

{
  "orderNumber": "the order number printed at the top, or null",
  "preppedBy": "the name written on the PICKED BY / signature line, or null",
  "lines": [
    { "index": 1, "actualQty": 2, "note": null, "confidence": 0.95 }
  ],
  "extras": [
    { "description": "what was written in that is not a printed line", "actualQty": 1, "note": null }
  ],
  "notes": "free text written elsewhere on the sheet, or null",
  "unreadable": null
}

RULES — read them carefully, they are the difference between helping and
causing damage:

1. ONLY include a line in "lines" if a human actually wrote something for
   it: a count, a tick, a cross, a circle, a correction. A line that is
   blank on the paper must be OMITTED entirely. Do NOT helpfully repeat
   the ordered quantity for untouched lines — we already have that, and
   an invented value is indistinguishable from a confirmed one.
2. A tick, check mark, or "OK" against a line means it went as ordered:
   report actualQty equal to the printed ordered quantity, confidence
   high.
3. A crossed-out line, a zero, or "DNS"/"did not send" means actualQty 0.
4. A number written over or beside the printed quantity REPLACES it.
5. If someone wrote a different item name next to a line (a swap), keep
   the line's actualQty and put the swapped-in item's name in "note",
   prefixed exactly with "SWAP: ".
6. "confidence" is yours, per line, 0 to 1. Be honest and be harsh.
   Anything you are guessing at should be below 0.6. A supervisor is
   going to review this, and a low number tells them where to look.
7. If the photo is too blurred, dark, cropped or angled to read
   reliably, set "unreadable" to a one-sentence description of the
   problem and return empty lines/extras. Do not guess your way through
   a bad photo.
8. Never invent a line index that is not in the printed list above.
   Anything written in that is not a printed line belongs in "extras".`
}

export async function readPickSheetPhoto(args: {
  data: Buffer
  mimeType: string
  lines: PrintedLine[]
  edge: 'OUT' | 'IN'
}): Promise<SheetRead> {
  const mediaType = args.mimeType.includes('png')
    ? 'image/png'
    : args.mimeType.includes('webp')
      ? 'image/webp'
      : 'image/jpeg'

  const response = await client.messages.create({
    model: REVIEW_MODEL,
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: mediaType as 'image/png' | 'image/jpeg' | 'image/webp',
              data: args.data.toString('base64'),
            },
          },
          { type: 'text' as const, text: prompt(args.lines, args.edge) },
        ],
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const raw = parseAiJson<Partial<SheetRead>>(text, {
    tag: 'pick-sheet-photo',
    stopReason: response.stop_reason,
  })

  // Normalise defensively: this feeds a form that rewrites a client's
  // order, so every field is clamped to something a human can review
  // rather than trusted as returned.
  const known = new Set(args.lines.map((l) => l.index))
  return {
    orderNumber: typeof raw.orderNumber === 'string' ? raw.orderNumber : null,
    preppedBy: typeof raw.preppedBy === 'string' ? raw.preppedBy : null,
    notes: typeof raw.notes === 'string' ? raw.notes : null,
    unreadable: typeof raw.unreadable === 'string' && raw.unreadable.trim() ? raw.unreadable : null,
    lines: Array.isArray(raw.lines)
      ? raw.lines
          .filter((l) => l && known.has(Number(l.index)) && Number.isFinite(Number(l.actualQty)))
          .map((l) => ({
            index: Number(l.index),
            actualQty: Math.max(0, Math.round(Number(l.actualQty))),
            note: typeof l.note === 'string' && l.note.trim() ? l.note.trim() : null,
            confidence: Math.min(1, Math.max(0, Number(l.confidence) || 0)),
          }))
      : [],
    extras: Array.isArray(raw.extras)
      ? raw.extras
          .filter((e) => e && typeof e.description === 'string' && e.description.trim())
          .map((e) => ({
            description: e.description.trim(),
            actualQty: Math.max(0, Math.round(Number(e.actualQty) || 0)),
            note: typeof e.note === 'string' && e.note.trim() ? e.note.trim() : null,
          }))
      : [],
  }
}
