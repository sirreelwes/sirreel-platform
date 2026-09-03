import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import { COLLECTIONS_EVIDENCE_MODEL } from '@/lib/ai/models'
import { parseAiJson } from '@/lib/ai/extractJson'
import { findInvoiceEmails, type EvidenceHit, type InvoiceForEvidence } from '@/lib/collections/invoiceEvidence'

/**
 * Reading an aging invoice's email trail and saying whether it looks paid.
 *
 * Wes, 2026-09-02: the review desk should carry "the emails we have referenced
 * and summary of what AI thinks about whether it has been paid."
 *
 * ── Why a model rather than a keyword rule ─────────────────────────────────
 *
 * A regex was tried first, over the same corpus, and it was wrong more often
 * than right: it flagged nine invoices as showing "payment language" and only
 * ONE of those was a payment. The rest were a client confirming receipt of the
 * invoice, a dispute over a line item, an insurance refund thread, a promise to
 * pay that never landed, and a false positive where the invoice number happened
 * to appear as a Quote# in a dispatch email. Telling those apart is reading
 * comprehension, not pattern matching.
 *
 * ── The verdict is advisory and says so ───────────────────────────────────
 *
 * Nothing here writes money, changes a balance, or clears an invoice. It sorts
 * a worklist and shows its reasoning next to the emails it read, so Ana can
 * disagree in one glance. LIKELY_PAID is an instruction to go and check, never
 * a statement that the money arrived.
 *
 * The prompt is deliberately biased toward LIKELY_OPEN. The asymmetry is real:
 * a wrongly-open invoice costs a phone call, a wrongly-paid one silently stops
 * the chase on money we are owed.
 */

export const VERDICTS = ['LIKELY_PAID', 'LIKELY_OPEN', 'DISPUTED', 'INSURANCE', 'NO_EVIDENCE'] as const
export type Verdict = (typeof VERDICTS)[number]

export const VERDICT_LABEL: Record<Verdict, string> = {
  LIKELY_PAID: 'Looks paid — check',
  LIKELY_OPEN: 'Still owed',
  DISPUTED: 'Disputed',
  INSURANCE: 'Insurance / claim',
  NO_EVIDENCE: 'No email found',
}

export interface ScanTarget extends InvoiceForEvidence {
  rwInvoiceId: string
  remainingTotal: number
  invoiceDate: Date | null
}

const MAX_TOKENS = 1200

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

function buildPrompt(inv: ScanTarget, hits: EvidenceHit[]): string {
  const emails = hits
    .map(
      (h, i) =>
        `--- EMAIL ${i + 1} (match confidence: ${h.tier}) ---\n` +
        `date: ${new Date(h.sentAt).toISOString().slice(0, 10)}\n` +
        `from: ${h.fromAddress}\n` +
        `subject: ${h.subject ?? '(none)'}\n` +
        `body: ${h.excerpt}`,
    )
    .join('\n\n')

  return `You are helping SirReel's billing coordinator review an aging invoice.

INVOICE
  number:   ${inv.invoiceNumber ?? '(none)'}
  client:   ${inv.customerName ?? '(unknown)'}
  job/deal: ${inv.dealName ?? '(unknown)'}
  dated:    ${inv.invoiceDate ? new Date(inv.invoiceDate).toISOString().slice(0, 10) : '(unknown)'}
  RentalWorks still shows $${inv.remainingTotal.toFixed(2)} outstanding.

EMAILS FOUND (may be unrelated — judge that yourself)
${emails || '(none found)'}

Decide which ONE verdict fits:
  LIKELY_PAID  Someone states the payment was actually SENT or MADE — a wire
               confirmation, a remittance advice, a check number, "paid on
               the 14th". Not merely promised, not merely approved.
  LIKELY_OPEN  No evidence it was paid. This is the default and the safe answer.
               A client confirming they RECEIVED the invoice is not payment. A
               promise to pay is not payment. Approval to pay is not payment.
  DISPUTED     The client is contesting the amount or what was delivered.
  INSURANCE    The balance is riding on an insurance claim or a damage refund,
               not on the client paying an ordinary rental invoice.
  NO_EVIDENCE  The emails are unrelated to this invoice, or there are none.

Rules:
- The emails were matched by fuzzy search. If they are about a different job or
  client, say so and answer NO_EVIDENCE.
- RentalWorks showing a balance is NOT evidence of non-payment — a payment
  landing in the bank and never being cleared in RentalWorks is exactly what
  this review is looking for.
- Prefer LIKELY_OPEN when torn. A wrong "paid" stops us chasing real money.

Reply with ONLY this JSON:
{"verdict":"<one of the five>","confidence":<0.0-1.0>,"summary":"<=45 words, plain English, cite who said what and when if it matters>"}`
}

export interface ScanResult {
  rwInvoiceId: string
  verdict: Verdict
  confidence: number
  summary: string
  evidence: EvidenceHit[]
}

/**
 * Evidence + verdict for one invoice. Never throws — a failed scan records
 * NO_EVIDENCE with the reason so the row still renders.
 *
 * `opts.evidence` overrides the search. The synced corpus only reaches back to
 * 2026-03-11 and never held `jobs@` at all, so a caller that has gone to Gmail
 * directly can hand the messages in and get the same verdict logic applied to
 * them — one definition of "what does this thread say", two ways of finding it.
 */
export async function scanInvoice(
  inv: ScanTarget,
  opts: { evidence?: EvidenceHit[] } = {},
): Promise<ScanResult> {
  const evidence = opts.evidence ?? (await findInvoiceEmails(inv))

  if (evidence.length === 0) {
    return {
      rwInvoiceId: inv.rwInvoiceId,
      verdict: 'NO_EVIDENCE',
      confidence: 1,
      summary: 'No email in the last six months mentions this invoice, its job name, or this client in a billing thread.',
      evidence,
    }
  }

  const client = getClient()
  if (!client) {
    return {
      rwInvoiceId: inv.rwInvoiceId,
      verdict: 'NO_EVIDENCE',
      confidence: 0,
      summary: `${evidence.length} related email(s) found, but the AI reviewer is not configured.`,
      evidence,
    }
  }

  try {
    const res = await client.messages.create({
      model: COLLECTIONS_EVIDENCE_MODEL,
      max_tokens: MAX_TOKENS,
      // `thinking` is deliberately omitted rather than set: Opus 5 runs
      // adaptive thinking by default when the parameter is absent, and the
      // installed SDK's types predate the 'adaptive' literal.
      messages: [{ role: 'user', content: buildPrompt(inv, evidence) }],
    })
    const raw = res.content.find((b) => b.type === 'text')
    const parsed = parseAiJson(raw && raw.type === 'text' ? raw.text : '', {
      tag: 'rw-invoice-review',
      stopReason: res.stop_reason,
    }) as { verdict?: string; confidence?: number; summary?: string }

    const verdict = (VERDICTS as readonly string[]).includes(parsed.verdict ?? '')
      ? (parsed.verdict as Verdict)
      : 'LIKELY_OPEN'
    return {
      rwInvoiceId: inv.rwInvoiceId,
      verdict,
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      summary: String(parsed.summary ?? '').slice(0, 600),
      evidence,
    }
  } catch (err) {
    console.error('[rw-invoice-review] scan failed', inv.invoiceNumber, err instanceof Error ? err.message : err)
    return {
      rwInvoiceId: inv.rwInvoiceId,
      verdict: 'LIKELY_OPEN',
      confidence: 0,
      summary: `${evidence.length} related email(s) found; the AI review did not complete. Read them below.`,
      evidence,
    }
  }
}

/** Persist a scan. A human note is never touched. */
export async function saveScan(r: ScanResult): Promise<void> {
  const data = {
    aiVerdict: r.verdict,
    aiConfidence: r.confidence,
    aiSummary: r.summary,
    evidence: r.evidence as unknown as object,
    evidenceCount: r.evidence.length,
    scannedAt: new Date(),
  }
  await prisma.rwInvoiceReview.upsert({
    where: { rwInvoiceId: r.rwInvoiceId },
    create: { rwInvoiceId: r.rwInvoiceId, ...data },
    update: data,
  })
}
