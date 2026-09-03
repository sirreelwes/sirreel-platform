import { prisma } from '@/lib/prisma'

/**
 * Finding the email trail for a RentalWorks invoice.
 *
 * Wes, 2026-09-02, on the 55 open invoices with no HQ job behind them: "search
 * by client and deal name also and let's create a dedicated aging RW invoices
 * for review by Ana and Admin."
 *
 * ── Why searching by invoice number alone was not enough ───────────────────
 *
 * Measured before writing this: of 55 orphan invoices, the invoice number
 * appears anywhere in six months of synced mail for only 10. That is not
 * because the invoices were never sent — RentalWorks mails them from its own
 * server (no-reply@rentalworksweb.com), so HQ's corpus catches a thread only
 * when somebody REPLIES. Of 4,467 messages with "invoice" in the subject, zero
 * are outbound. Searching for the number finds the conversations that came
 * back and misses every one that did not.
 *
 * ── Three tiers, because the obvious widening is a false-positive machine ──
 *
 * Deal names are short and generic — real examples on open invoices include
 * "Hawk", "Garage", "Diner" and "Impressions". Matching those as bare strings
 * across 50,000 messages returns mostly noise, and noise fed to an AI that is
 * judging whether money arrived is worse than no evidence at all.
 *
 *   STRONG   the invoice number appears. Unambiguous.
 *   LIKELY   deal name AND a distinctive client token in the same message.
 *   WEAK     a distinctive client token, in a message that is visibly about
 *            billing (subject mentions invoice / payment / remittance).
 *
 * Tier travels with each hit so the reviewer — and the model — can weigh a
 * "Hawk" match differently from an invoice-number match.
 */

export type EvidenceTier = 'STRONG' | 'LIKELY' | 'WEAK'

export interface EvidenceHit {
  tier: EvidenceTier
  gmailMessageId: string
  subject: string | null
  fromAddress: string
  direction: string | null
  sentAt: Date
  excerpt: string
}

export interface InvoiceForEvidence {
  invoiceNumber: string | null
  orderNumber: string | null
  dealName: string | null
  customerName: string | null
}

/** Words that make a company name un-distinctive. A search for "Inc" is a
 *  search for nothing. */
const STOPWORDS = new Set([
  'inc', 'llc', 'ltd', 'corp', 'co', 'company', 'the', 'and', 'dba', 'productions',
  'production', 'studios', 'studio', 'media', 'films', 'film', 'group', 'a', 'of',
  'entertainment', 'pictures', 'creative', 'llp', 'lp', 'plc', 'incorporated',
])

/**
 * The most identifying run of words in a company name.
 *
 * "Something Ideal LLC, DBA: Mssng Peces" → "something ideal". Everything after
 * the first comma is dropped (it is nearly always a DBA or entity suffix), then
 * stopwords go, then the two longest remaining words in order. Two words rather
 * than one because a single common word ("Coming", "Noire") matches too much.
 */
export function clientToken(customerName: string | null): string | null {
  if (!customerName) return null
  const head = customerName.split(/[,/]/)[0]
  const words = head
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  if (words.length === 0) return null
  return words.slice(0, 2).join(' ')
}

/** Deal names shorter than this are too generic to search on their own. */
const MIN_DEAL_LEN = 4

const EXCERPT_LEN = 600

function rowToHit(tier: EvidenceTier, r: any): EvidenceHit {
  return {
    tier,
    gmailMessageId: r.gmail_message_id,
    subject: r.subject,
    fromAddress: r.from_address,
    direction: r.direction,
    sentAt: r.sent_at,
    excerpt: String(r.body ?? '').replace(/\s+/g, ' ').trim().slice(0, EXCERPT_LEN),
  }
}

const SELECT = `SELECT gmail_message_id, subject, from_address, direction, sent_at,
                left(coalesce(body_text, snippet, ''), 4000) AS body
                FROM email_messages WHERE duplicate_of_id IS NULL`

/**
 * Every message that plausibly concerns this invoice, best tier first, deduped
 * by Gmail id (a message that matches two ways keeps its strongest tier).
 */
export async function findInvoiceEmails(
  inv: InvoiceForEvidence,
  limit = 12,
): Promise<EvidenceHit[]> {
  const seen = new Map<string, EvidenceHit>()
  const add = (tier: EvidenceTier, rows: any[]) => {
    for (const r of rows) {
      if (!seen.has(r.gmail_message_id)) seen.set(r.gmail_message_id, rowToHit(tier, r))
    }
  }

  // STRONG — the invoice number itself.
  if (inv.invoiceNumber) {
    add(
      'STRONG',
      await prisma.$queryRawUnsafe<any[]>(
        `${SELECT} AND (subject ILIKE '%'||$1||'%' OR body_text ILIKE '%'||$1||'%' OR snippet ILIKE '%'||$1||'%')
         ORDER BY sent_at DESC LIMIT $2`,
        inv.invoiceNumber,
        limit,
      ),
    )
  }

  const token = clientToken(inv.customerName)
  const deal = (inv.dealName ?? '').trim()

  // LIKELY — deal name and client together. Neither is safe alone; together
  // they are effectively a compound key.
  if (token && deal.length >= MIN_DEAL_LEN) {
    add(
      'LIKELY',
      await prisma.$queryRawUnsafe<any[]>(
        `${SELECT}
           AND (subject ILIKE '%'||$1||'%' OR body_text ILIKE '%'||$1||'%')
           AND (subject ILIKE '%'||$2||'%' OR body_text ILIKE '%'||$2||'%')
         ORDER BY sent_at DESC LIMIT $3`,
        deal,
        token,
        limit,
      ),
    )
  }

  // WEAK — the client, in a thread that is visibly about billing.
  if (token) {
    add(
      'WEAK',
      await prisma.$queryRawUnsafe<any[]>(
        `${SELECT}
           AND (subject ILIKE '%'||$1||'%' OR body_text ILIKE '%'||$1||'%')
           AND (subject ILIKE '%invoice%' OR subject ILIKE '%payment%' OR subject ILIKE '%remit%'
                OR subject ILIKE '%past due%' OR subject ILIKE '%balance%')
         ORDER BY sent_at DESC LIMIT $2`,
        token,
        limit,
      ),
    )
  }

  const RANK: Record<EvidenceTier, number> = { STRONG: 0, LIKELY: 1, WEAK: 2 }
  return [...seen.values()]
    .sort((a, b) => RANK[a.tier] - RANK[b.tier] || +new Date(b.sentAt) - +new Date(a.sentAt))
    .slice(0, limit)
}
