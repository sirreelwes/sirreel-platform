import Anthropic from '@anthropic-ai/sdk'
import { PARSING_MODEL } from '@/lib/ai/models'
import { parseAiJson } from '@/lib/ai/extractJson'
import {
  fetchGmailMessageFull,
  downloadInboxAttachment,
  type GmailAttachmentMeta,
} from '@/lib/email/persistGmailAttachments'

/**
 * Reading one email and deciding whether a vendor is billing SirReel — and
 * if so, for what.
 *
 * ── Why the PDF is fetched rather than the stored body read ────────────────
 * A vendor invoice is a document. The email carrying it usually says
 * "Invoice attached, thanks!" and nothing else — the number, the amount, the
 * PO reference and the due date are all inside the PDF. Extracting from
 * `bodyText` alone would produce a desk full of rows with a vendor name and
 * four nulls, which is worse than no desk: it looks like data.
 *
 * So the bytes are pulled fresh from Gmail through DWD and handed to the
 * model as a document block, the same way claim documents, COIs and contract
 * redlines are already read. They are NOT stored — see downloadInboxAttachment.
 *
 * When Gmail is unreachable, or nothing is attached, the read falls back to
 * the stored body and the result records `readPdf: false`. The desk shows
 * that, because a body-only read of a bill is exactly the row a human should
 * not take at face value.
 *
 * ── The question the model is actually for ────────────────────────────────
 * Direction of trade. SirReel invoices productions constantly, and those
 * threads are full of the same words a vendor bill uses. A regex cannot tell
 * "here is our invoice, Net 30" from "please find our invoice, Net 30"; that
 * is reading comprehension, and getting it backwards would put SirReel's own
 * receivables on a payables desk.
 *
 * Sonnet rather than Haiku, matching the other money-document readers here:
 * the output is a dollar figure and a PO reference someone will act on.
 */

const MODEL = PARSING_MODEL
const MAX_TOKENS = 1500
/** One PDF, and only a small one — a 20MB scanned catalogue is not the bill. */
const MAX_PDF_BYTES = 8 * 1024 * 1024
const BODY_CHARS = 12000

export interface ExtractedBill {
  isBill: boolean
  vendorName: string | null
  invoiceNumber: string | null
  invoiceDate: string | null
  dueDate: string | null
  amountTotal: number | null
  currency: string | null
  terms: string | null
  poNumber: string | null
  jobReference: string | null
  lineSummary: string | null
  summary: string
  confidence: number
  /** Set by the caller path, not the model. */
  readPdf: boolean
  attachmentNames: string[]
  model: string
}

const FALLBACK = (why: string): ExtractedBill => ({
  isBill: false,
  vendorName: null,
  invoiceNumber: null,
  invoiceDate: null,
  dueDate: null,
  amountTotal: null,
  currency: null,
  terms: null,
  poNumber: null,
  jobReference: null,
  lineSummary: null,
  summary: why,
  confidence: 0,
  readPdf: false,
  attachmentNames: [],
  model: MODEL,
})

const PROMPT = `SirReel Production Vehicles rents production vehicles, stages and gear TO film/TV/commercial productions. It also BUYS: sub-rentals from peer rental houses, parts, fuel, repairs, insurance, software, freight, and services.

You are reading ONE email that arrived in a SirReel mailbox. Decide whether it is a VENDOR BILLING SIRREEL, and extract what is on the bill.

Output strict JSON only — no markdown fences, no preamble:

{
  "isBill": boolean,
  "vendorName": string | null,
  "invoiceNumber": string | null,
  "invoiceDate": "YYYY-MM-DD" | null,
  "dueDate": "YYYY-MM-DD" | null,
  "amountTotal": number | null,
  "currency": string | null,
  "terms": string | null,
  "poNumber": string | null,
  "jobReference": string | null,
  "lineSummary": string | null,
  "summary": string,
  "confidence": number
}

THE DECISION THAT MATTERS — which way is the money going?

isBill = true ONLY when someone is asking SIRREEL TO PAY THEM. The sender is
the creditor, SirReel is the debtor.

isBill = false for every one of these, no matter how much billing language
they contain:
  - a client, producer or production company writing about an invoice SIRREEL
    sent THEM (this is receivable, not payable — it is the most common thing
    in this mailbox and the easiest to get backwards)
  - a client sending payment, a remittance advice, or a deposit confirmation
    FOR a SirReel invoice
  - a quote, estimate, proposal or rate sheet — nothing is owed yet
  - a bank / card / payment-processor notification, a receipt for something
    already paid, or a statement with a zero balance
  - marketing that merely mentions invoicing or billing software
  - an internal SirReel message

If you cannot tell which direction the money flows, set isBill=false and say
so in summary. A missed bill is recoverable; a receivable filed as a payable
is a wrong number in front of the owner.

FIELD RULES

vendorName    The company asking to be paid, as printed on the invoice —
              prefer the letterhead name over the email display name.
invoiceNumber THE VENDOR'S OWN invoice number for this bill.
amountTotal   The single number SirReel is being asked to pay: the grand
              total, after tax and after any credit already applied. Not a
              line item, not a subtotal. On a multi-invoice statement, the
              total amount due. Digits only, no currency symbol or commas.
              null if the document does not state a total. Never compute one.
currency      ISO code ("USD"). Default null rather than assuming.
terms         Payment terms as written ("Net 30", "Due on receipt").
poNumber      A SIRREEL purchase-order reference the vendor is citing —
              labelled "PO", "P.O.", "Purchase Order", "PO #", "Your PO",
              "Customer PO", "Your order #", "Reference". THIS IS NOT THE
              VENDOR'S OWN invoice / order / quote / job number. If the only
              number on the document is the vendor's own, poNumber is null.
              Copy it EXACTLY as printed, including any prefix.
jobReference  The show, production, job or unit the bill is for, as written
              ("Desigual x DL", "Stage 2", "Unit 4407"). Free text.
lineSummary   One line on what is being billed for ("3-day sub-rental, 26ft
              cube + liftgate").
summary       One plain sentence: who is billing SirReel, for what, how much.
              When isBill=false, say what the email actually is instead.
confidence    0.0-1.0, how complete and certain the extraction is. Below 0.5
              means a human should open the document themselves.

Dates: ISO YYYY-MM-DD, and only when the document states a calendar date. A
date written without a year takes the year nearest the email's send date.
Never invent a due date from terms — if it says "Net 30" and prints no due
date, dueDate is null and terms carries "Net 30".

Anything not stated is null. Do not guess, and do not fill a field from the
email signature when the document says otherwise — the DOCUMENT wins.`

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

function isPdf(a: GmailAttachmentMeta): boolean {
  return a.mimeType === 'application/pdf' || /\.pdf$/i.test(a.filename)
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,\s]/g, '')
    const n = Number(cleaned)
    if (Number.isFinite(n)) return n
  }
  return null
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t && t.toLowerCase() !== 'null' ? t : null
}

/** Accept only a real ISO date — the column is a DATE and a junk string
 *  would throw at write time, well away from the cause. */
function isoDate(v: unknown): string | null {
  const s = str(v)
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? null : s
}

function coerce(raw: unknown, readPdf: boolean, names: string[]): ExtractedBill {
  const o = (raw ?? {}) as Record<string, unknown>
  const conf = num(o.confidence)
  return {
    isBill: o.isBill === true,
    vendorName: str(o.vendorName),
    invoiceNumber: str(o.invoiceNumber),
    invoiceDate: isoDate(o.invoiceDate),
    dueDate: isoDate(o.dueDate),
    amountTotal: num(o.amountTotal),
    currency: str(o.currency)?.slice(0, 8) ?? null,
    terms: str(o.terms),
    poNumber: str(o.poNumber),
    jobReference: str(o.jobReference),
    lineSummary: str(o.lineSummary),
    summary: str(o.summary) ?? '(no summary)',
    confidence: conf === null ? 0 : Math.max(0, Math.min(1, conf)),
    readPdf,
    attachmentNames: names,
    model: MODEL,
  }
}

/**
 * Read one candidate email. Never throws past the caller — a Gmail outage or
 * a malformed model response collapses to isBill=false with the reason in
 * `summary`, which lands on the desk as a row to look at rather than a
 * silent gap.
 */
export async function extractBill(args: {
  inbox: string
  gmailMessageId: string
  fromAddress: string
  subject: string
  sentAt: Date
  /** Stored body — used when Gmail can't be reached for a fresh copy. */
  bodyText: string | null
}): Promise<ExtractedBill> {
  const client = getClient()
  if (!client) return FALLBACK('ANTHROPIC_API_KEY not set — nothing was read')

  // Fresh pull: the stored body can be a snippet, and attachment metadata
  // (which is where the invoice actually is) was never stored at all.
  const fetched = await fetchGmailMessageFull(args.inbox, args.gmailMessageId)
  const attachments = fetched?.attachments ?? []
  const attachmentNames = attachments.map((a) => a.filename)
  const body = (fetched?.bodyText ?? args.bodyText ?? '').slice(0, BODY_CHARS)

  // The first PDF small enough to send. Vendors attach one invoice; when
  // they attach several, the rest are usually the same bill's backup
  // (timecards, delivery receipts) and the desk links to Gmail for those.
  let pdfBuf: Buffer | null = null
  let pdfName: string | null = null
  for (const a of attachments) {
    if (!isPdf(a) || a.size > MAX_PDF_BYTES) continue
    pdfBuf = await downloadInboxAttachment({
      inbox: args.inbox,
      gmailMessageId: args.gmailMessageId,
      attachment: a,
    })
    if (pdfBuf) {
      pdfName = a.filename
      break
    }
  }

  const context =
    `EMAIL\n` +
    `  received in: ${args.inbox}\n` +
    `  from:        ${args.fromAddress}\n` +
    `  sent:        ${args.sentAt.toISOString().slice(0, 10)}\n` +
    `  subject:     ${args.subject || '(none)'}\n` +
    `  attachments: ${attachmentNames.length ? attachmentNames.join(', ') : '(none)'}\n\n` +
    `BODY\n${body || '(empty)'}\n\n` +
    (pdfName
      ? `The attached document "${pdfName}" is included above. Where it and the email body disagree, the document is the bill.`
      : `No document could be read — judge from the email text alone, and keep confidence low if the numbers are not stated in it.`)

  try {
    const content: Anthropic.Messages.ContentBlockParam[] = []
    if (pdfBuf) {
      content.push({
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: pdfBuf.toString('base64') },
      })
    }
    content.push({ type: 'text' as const, text: `${PROMPT}\n\n${context}` })

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content }],
    })
    const raw = res.content[0]?.type === 'text' ? res.content[0].text : ''
    const parsed = parseAiJson(raw, { tag: 'ap-extract-bill', stopReason: res.stop_reason })
    return coerce(parsed, !!pdfBuf, attachmentNames)
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    console.error('[ap-extract-bill] failed for', args.gmailMessageId, why)
    return { ...FALLBACK(`Could not be read: ${why}`), attachmentNames, readPdf: false }
  }
}
