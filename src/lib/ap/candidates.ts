import { prisma } from '@/lib/prisma'

/**
 * Which inbound emails are worth spending a model call on.
 *
 * ── The problem this solves ───────────────────────────────────────────────
 * "Invoice" is not a rare word in this corpus. Measured by the collections
 * work in September: 4,467 stored messages carry it in the SUBJECT alone,
 * and essentially all of them are accounts RECEIVABLE — clients replying
 * about invoices SirReel sent them. Reading all of those with Sonnet would
 * cost real money to learn nothing.
 *
 * So the pass is two-stage, cheap then expensive:
 *   1. this file — SQL + regex, free, deliberately over-inclusive
 *   2. extractBill — one Sonnet call that answers the only question that
 *      actually separates AP from AR: which direction is the money going?
 *
 * The regex never tries to answer that question. It cannot: "Invoice 4021
 * attached, Net 30" reads identically whether a vendor sent it to us or a
 * client is quoting ours back. It only asks "does this look like a bill at
 * all", and hands the rest to something that can read.
 *
 * ── The one thing it does rule out ────────────────────────────────────────
 * A message quoting a SirReel order / job number is ours by construction —
 * that number only exists on paperwork we issued — so it is AR or ops, not a
 * bill against us. That exclusion is safe in a way that guessing by vendor
 * name is not.
 */

/** Looks like a bill of some kind, in either direction. */
const BILLISH_RE =
  /\b(invoice|invoiced|invoicing|bill(?:ing)?|statement|remit(?:tance)?|amount due|balance due|total due|payment due|past[- ]due|net\s?(?:15|30|45|60)|payable to|purchase order|\bp\.?o\.?\s*#)/i

/** Phrases a party ASKING to be paid uses. Any one of these is enough on its
 *  own; the model still decides who is asking whom. */
const DEMAND_RE =
  /\b(please remit|remit(?:tance)? (?:to|advice)|payment (?:is )?due|amount due|balance due|total due|past[- ]due|net\s?(?:15|30|45|60)|due upon receipt|due on receipt|invoice attached|attached invoice|please find (?:our |the )?invoice|payable to|make (?:checks?|payment) payable|w-?9)/i

/** A SirReel-issued number. Its presence means the paperwork is ours. */
const OUR_PAPER_RE = /\b(S\d{6}-\d{3}|SR-ORD-\d+|SR-JOB-\d+|SR-REQ-\d+)\b/i

/** Attachment names that read as a bill rather than a photo or a call sheet. */
const BILL_FILE_RE = /(invoice|inv[-_ ]?\d|bill|statement|receipt|remit)/i

export interface BillCandidate {
  emailMessageId: string
  gmailMessageId: string
  inbox: string
  threadId: string | null
  sentAt: Date
  fromAddress: string
  subject: string
  bodyText: string | null
  attachmentCount: number
  /** Why it survived the filter — carried into the desk so a false positive
   *  can be traced to the rule that let it through. */
  reason: string
}

function bareEmail(from: string): string {
  const m = from.match(/<([^>]+)>/)
  return (m ? m[1] : from).trim().toLowerCase()
}

export function senderDomain(from: string): string | null {
  const at = bareEmail(from).lastIndexOf('@')
  if (at === -1) return null
  const d = bareEmail(from).slice(at + 1)
  return d || null
}

/**
 * Score one stored message. Returns the reason it qualifies, or null.
 *
 * Deliberately generous: an attachment plus the word "invoice" is enough.
 * A vendor bill that gets dropped here is invisible forever; a false
 * positive costs one Sonnet call and shows up on the desk as NOT_A_BILL,
 * which is a click.
 */
export function qualifies(m: {
  fromAddress: string
  subject: string
  bodyText: string | null
  attachmentCount: number
}): string | null {
  const from = bareEmail(m.fromAddress)
  if (from.endsWith('@sirreel.com')) return null

  const subject = m.subject || ''
  // Body is capped before regexing — a 400KB quoted thread contributes
  // nothing but CPU past the first few thousand characters.
  const body = (m.bodyText || '').slice(0, 8000)
  const hay = `${subject}\n${body}`

  if (OUR_PAPER_RE.test(hay)) return null
  if (!BILLISH_RE.test(hay)) return null

  if (DEMAND_RE.test(hay)) return 'asks to be paid'
  if (m.attachmentCount > 0 && BILLISH_RE.test(subject)) return 'billing subject + attachment'
  if (m.attachmentCount > 0 && BILLISH_RE.test(body)) return 'billing body + attachment'
  return null
}

/**
 * Unscanned candidates, newest first.
 *
 * `sinceDays` bounds the SQL side; `limit` bounds how many actually get read.
 * The gap between the two is intentional — the coarse SQL pass pulls a pool,
 * the regex thins it, and only what survives is counted against the limit,
 * so a batch of 10 always means 10 model calls rather than "10 rows, 2 of
 * which were worth reading".
 */
export async function findBillCandidates(args: {
  sinceDays: number
  limit: number
  /** Skip messages already on the desk (any ApBill row, including
   *  NOT_A_BILL — a rejected read must never be re-read). */
  skipEmailMessageIds: ReadonlySet<string>
}): Promise<BillCandidate[]> {
  const { sinceDays, limit, skipEmailMessageIds } = args
  const since = new Date(Date.now() - sinceDays * 86400000)

  const pool = await prisma.emailMessage.findMany({
    where: {
      direction: 'inbound',
      duplicateOfId: null,
      autoReply: false,
      sentAt: { gte: since },
      OR: [
        { subject: { contains: 'invoice', mode: 'insensitive' } },
        { subject: { contains: 'bill', mode: 'insensitive' } },
        { subject: { contains: 'statement', mode: 'insensitive' } },
        { subject: { contains: 'payment', mode: 'insensitive' } },
        { subject: { contains: 'remit', mode: 'insensitive' } },
        { subject: { contains: 'past due', mode: 'insensitive' } },
        { subject: { contains: 'purchase order', mode: 'insensitive' } },
        { bodyText: { contains: 'amount due', mode: 'insensitive' } },
        { bodyText: { contains: 'please remit', mode: 'insensitive' } },
        { bodyText: { contains: 'invoice attached', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      gmailMessageId: true,
      threadId: true,
      sentAt: true,
      fromAddress: true,
      subject: true,
      bodyText: true,
      attachmentCount: true,
      emailAccount: { select: { emailAddress: true } },
    },
    orderBy: { sentAt: 'desc' },
    take: 600,
  })

  const out: BillCandidate[] = []
  for (const m of pool) {
    if (out.length >= limit) break
    if (skipEmailMessageIds.has(m.id)) continue
    const reason = qualifies(m)
    if (!reason) continue
    out.push({
      emailMessageId: m.id,
      gmailMessageId: m.gmailMessageId,
      inbox: m.emailAccount.emailAddress,
      threadId: m.threadId,
      sentAt: m.sentAt,
      fromAddress: m.fromAddress,
      subject: m.subject,
      bodyText: m.bodyText,
      attachmentCount: m.attachmentCount,
      reason,
    })
  }
  return out
}

/** How many candidates are waiting, so the desk can say "read next 10 of 34". */
export async function countBillCandidates(args: {
  sinceDays: number
  skipEmailMessageIds: ReadonlySet<string>
}): Promise<number> {
  const all = await findBillCandidates({ ...args, limit: Number.MAX_SAFE_INTEGER })
  return all.length
}

export { BILL_FILE_RE }
