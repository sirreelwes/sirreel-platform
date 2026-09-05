/**
 * The client's one-click answer to a final invoice.
 *
 * Ana's collections email (the one she was sending by hand, 2026-09-05) ends
 * with a question — "Please confirm if we're approved to charge the credit
 * card (a 3% processing fee will apply), or if you prefer to pay via ACH or
 * check to avoid the fee" — and then the process stalls on a human reading
 * the reply. This module is the plumbing that turns the question into two
 * buttons: a reply token on the JobFinalInvoice, the public URL the buttons
 * point at, and the 3-business-day bank window her template quotes.
 *
 * The token is minted ONCE per invoice and reused on every resend, so a
 * button in last week's copy of the email still works. It is scoped to this
 * one answer — it opens no portal, shows no bank details, and cannot charge
 * anything by itself. Charging stays Ana's click on the collections desk;
 * the answer only tells her which click.
 */

import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl'
import { resolveWalletCardForJob } from '@/lib/payments/jobCardOnFile'

/**
 * The W-9. Ana's emails carried https://www.sirreel.com/w9, which is the
 * same document HQ serves: the legacy redirect map sends /w9 to
 * /api/public/forms/w9, which streams whatever an admin uploaded to the W-9
 * slot on /admin/forms. Naked host, one hop, and the URL clients already
 * recognise from her emails.
 */
export const W9_URL = `${PUBLIC_SITE_ORIGIN}/w9`

/** "ACH or check payments must be submitted within 3 business days." */
export const BANK_WINDOW_BUSINESS_DAYS = 3

export type ClientInvoiceAnswer = 'CARD' | 'BANK'

export function normalizeClientAnswer(v: unknown): ClientInvoiceAnswer | null {
  return v === 'CARD' ? 'CARD' : v === 'BANK' ? 'BANK' : null
}

/** 24 random bytes — the URL is the credential, same sizing as pay-details. */
const TOKEN_BYTES = 24
export const REPLY_TOKEN_RE = /^[a-f0-9]{48}$/

/** Mint the reply token if the invoice has none; otherwise hand back the one it has. */
export async function ensureReplyToken(finalInvoiceId: string): Promise<string> {
  const row = await prisma.jobFinalInvoice.findUnique({
    where: { id: finalInvoiceId },
    select: { replyToken: true },
  })
  if (row?.replyToken) return row.replyToken
  const token = randomBytes(TOKEN_BYTES).toString('hex')
  await prisma.jobFinalInvoice.update({
    where: { id: finalInvoiceId },
    data: { replyToken: token },
  })
  return token
}

/**
 * Where the buttons land. On the marketing host, like pay-details — it is
 * the host clients recognise, which matters on a link about money. `answer`
 * pre-selects the choice; the page still asks for one confirming click, so
 * a mail scanner that follows links cannot answer on the client's behalf.
 */
export function invoiceReplyUrl(token: string, answer?: ClientInvoiceAnswer): string {
  const base = `${PUBLIC_SITE_ORIGIN}/invoice/${token}`
  return answer ? `${base}?answer=${answer.toLowerCase()}` : base
}

// ── The bank window ──────────────────────────────────────────────────────
//
// Calendar arithmetic in Pacific time, and DAYS rather than instants: the
// promise in the email is "by Wednesday", not "by 23:59:59.999 -07:00". A
// due DAY is a 'YYYY-MM-DD' string, compared lexically against today's
// Pacific date — no offsets to get wrong.

const PACIFIC = 'America/Los_Angeles'

function pacificYmd(d: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { y: get('year'), m: get('month'), d: get('day') }
}

function ymdString(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * The calendar day N business days after `from` (Pacific), weekends
 * skipped. Sent on a Friday, 3 business days lands on Wednesday. Holidays
 * are not modelled — Ana's template never mentioned them either.
 */
export function addBusinessDays(from: Date, days: number): string {
  const { y, m, d } = pacificYmd(from)
  // Walk in UTC on a noon-anchored date so DST cannot shift the day.
  const cur = new Date(Date.UTC(y, m - 1, d, 12))
  let left = days
  while (left > 0) {
    cur.setUTCDate(cur.getUTCDate() + 1)
    const dow = cur.getUTCDay()
    if (dow !== 0 && dow !== 6) left -= 1
  }
  return ymdString(cur.getUTCFullYear(), cur.getUTCMonth() + 1, cur.getUTCDate())
}

/** The day a bank payment is due for an invoice emailed at `emailedAt`. */
export function bankDueDay(emailedAt: Date | null | undefined): string | null {
  return emailedAt ? addBusinessDays(emailedAt, BANK_WINDOW_BUSINESS_DAYS) : null
}

/** Today's Pacific date as 'YYYY-MM-DD', for comparing against a due day. */
export function todayPacific(now: Date = new Date()): string {
  const { y, m, d } = pacificYmd(now)
  return ymdString(y, m, d)
}

/** True once the due day is behind us (Pacific). */
export function isPastDueDay(dueDay: string, now: Date = new Date()): boolean {
  return todayPacific(now) > dueDay
}

/** "Wednesday, September 9" — how the email and the page say the day. */
export function formatDueDay(dueDay: string, opts: { weekday?: boolean } = {}): string {
  const [y, m, d] = dueDay.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    ...(opts.weekday === false ? {} : { weekday: 'long' }),
    month: 'long',
    day: 'numeric',
  })
}

// ── The card the email offers ────────────────────────────────────────────

export interface OfferedCard {
  last4: string | null
  cardType: string | null
}

/**
 * The card "we have on file for this project", display fields only, asked of
 * BOTH stores a card can live in (see jobCardOnFile.ts — the payment-options
 * email used to read only the portal authorization, so a card Jose keyed
 * into the company wallet produced an email that asked the client to
 * authorize a card they had already given us). Portal card first, because
 * it is the one tied to this booking; the wallet answers for the company.
 */
export async function cardOfferedForJob(
  jobId: string,
  companyId: string | null | undefined,
): Promise<OfferedCard | null> {
  const bookings = await prisma.booking.findMany({ where: { jobId }, select: { id: true } })
  if (bookings.length > 0) {
    const pw = await prisma.paperworkRequest.findFirst({
      where: {
        bookingId: { in: bookings.map((b) => b.id) },
        ccCardNumberEncrypted: { not: null },
      },
      orderBy: { sentAt: 'desc' },
      select: { ccCardLast4: true, ccCardType: true },
    })
    if (pw) return { last4: pw.ccCardLast4, cardType: pw.ccCardType }
  }
  const wallet = await resolveWalletCardForJob(companyId, jobId)
  if (wallet && !wallet.expired) return { last4: wallet.last4, cardType: wallet.cardType }
  return null
}

/** "the Visa ending ····5544" / "the card ending ····5544". */
export function describeCard(card: OfferedCard): string {
  const type = card.cardType?.trim()
  return `the ${type ? `${type} ` : ''}card ending ····${card.last4 ?? '????'}`
}
