/**
 * /api/public/invoice-reply/[token] — the client's answer to a final invoice.
 *
 *   GET  → what the page needs to ask the question: the show, the amount,
 *          the card we offered (last four only), the bank window, and any
 *          answer already given.
 *   POST → { answer: 'CARD' | 'BANK', note? } records it on the
 *          JobFinalInvoice and tells billing.
 *
 * The token IS the credential (24 random bytes, minted by
 * lib/collections/invoiceReply.ts). It is scoped to this one answer: it
 * grants no portal access, shows no bank details, and cannot charge
 * anything — a CARD answer is consent that Ana acts on from the collections
 * desk, where the charge route's own guards still apply. There is nothing
 * here for a phishing kit to harvest and nothing an attacker gains by
 * answering on someone's behalf except a card charge to the client's own
 * invoice, which is the outcome the invoice asked for.
 *
 * Uniform 404 for every failure to resolve the token — never existed,
 * revoked, garbage. A settled invoice is NOT a failure: the page says
 * "thank you, this is paid" rather than pretending the link never existed.
 *
 * Not rate-limited by IP, for the same reason pay-details is not: an A/P
 * department behind one NAT opening the same link is the normal case.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { createPaymentShare, paymentShareBaseUrl } from '@/lib/payments/paymentShare'
import {
  bankDueDay,
  cardOfferedForJob,
  describeCard,
  formatDueDay,
  normalizeClientAnswer,
  REPLY_TOKEN_RE,
} from '@/lib/collections/invoiceReply'

export const dynamic = 'force-dynamic'

const NOTE_MAX = 500

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

async function loadByToken(raw: string) {
  const token = (raw || '').trim()
  if (!REPLY_TOKEN_RE.test(token)) return null
  return prisma.jobFinalInvoice.findUnique({
    where: { replyToken: token },
    select: {
      id: true,
      status: true,
      amount: true,
      invoiceNumber: true,
      emailedAt: true,
      emailedTo: true,
      clientAnswer: true,
      clientAnsweredAt: true,
      clientAnswerNote: true,
      clientAnswerCardLast4: true,
      job: {
        select: {
          id: true,
          name: true,
          jobCode: true,
          companyId: true,
          company: { select: { name: true } },
        },
      },
    },
  })
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const gone = NextResponse.json({ ok: false, reason: 'unavailable' }, { status: 404 })
  const fi = await loadByToken(params.token)
  if (!fi) return gone

  const settled = fi.status !== 'READY'
  const card = settled ? null : await cardOfferedForJob(fi.job.id, fi.job.companyId)
  const dueDay = bankDueDay(fi.emailedAt)

  return NextResponse.json({
    ok: true,
    settled,
    jobName: fi.job.name,
    invoiceNumber: fi.invoiceNumber,
    amount: Number(fi.amount),
    card: card ? { last4: card.last4, cardType: card.cardType } : null,
    bankDueBy: dueDay ? formatDueDay(dueDay) : null,
    answered: fi.clientAnswer
      ? {
          answer: fi.clientAnswer,
          at: fi.clientAnsweredAt,
          note: fi.clientAnswerNote,
          cardLast4: fi.clientAnswerCardLast4,
        }
      : null,
  })
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const gone = NextResponse.json({ ok: false, reason: 'unavailable' }, { status: 404 })
  const fi = await loadByToken(params.token)
  if (!fi) return gone
  if (fi.status !== 'READY') {
    return NextResponse.json({ ok: false, reason: 'settled' }, { status: 409 })
  }

  const body = (await req.json().catch(() => null)) as { answer?: unknown; note?: unknown } | null
  const answer = normalizeClientAnswer(body?.answer)
  if (!answer) return NextResponse.json({ ok: false, reason: 'bad_answer' }, { status: 400 })
  const note =
    typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, NOTE_MAX) : null

  // A CARD answer is consent for a SPECIFIC card — the one the email named.
  // If that card is gone (removed from the wallet, expired) there is nothing
  // to consent to; the page falls back to asking for a bank payment.
  const card = await cardOfferedForJob(fi.job.id, fi.job.companyId)
  if (answer === 'CARD' && !card) {
    return NextResponse.json({ ok: false, reason: 'no_card' }, { status: 400 })
  }

  const answeredAt = new Date()
  await prisma.$transaction([
    prisma.jobFinalInvoice.update({
      where: { id: fi.id },
      data: {
        clientAnswer: answer,
        clientAnsweredAt: answeredAt,
        clientAnswerNote: note,
        clientAnswerCardLast4: answer === 'CARD' ? (card?.last4 ?? null) : null,
      },
    }),
    prisma.auditLog.create({
      data: {
        action: 'final_invoice.client_answer',
        entityType: 'JobFinalInvoice',
        entityId: fi.id,
        oldValues: fi.clientAnswer
          ? { clientAnswer: fi.clientAnswer, clientAnsweredAt: fi.clientAnsweredAt }
          : undefined,
        newValues: {
          clientAnswer: answer,
          cardLast4: answer === 'CARD' ? (card?.last4 ?? null) : null,
          note,
          via: 'invoice-reply-link',
          emailedTo: fi.emailedTo,
        },
      },
    }),
  ])

  // A bank answer gets the bank details again, right here — the client is
  // on the page that asked, and sending them back to the email to find the
  // link is how the payment waits a week. Same share flow as the email.
  let payDetailsLink: string | null = null
  if (answer === 'BANK' && fi.emailedTo) {
    try {
      const share = await createPaymentShare({
        sentToEmail: fi.emailedTo,
        createdVia: 'OPERATOR',
      })
      payDetailsLink = `${paymentShareBaseUrl()}/pay-details/${share.token}`
    } catch (err) {
      console.error('[invoice-reply] could not mint a pay-details share:', err)
    }
  }

  const dueDay = bankDueDay(fi.emailedAt)
  const bankDueBy = dueDay ? formatDueDay(dueDay) : null

  // Tell billing — this is the reply Ana used to read in her inbox, so it
  // goes to the same audience that is copied on the invoice itself.
  // Fire-and-forget: the answer is recorded and the queue shows it either
  // way; a notification hiccup must not fail the client's click.
  void notifyBilling({
    answer,
    fi,
    cardDesc: card ? describeCard(card) : null,
    note,
    bankDueBy,
  }).catch((err) => console.error('[invoice-reply] billing notify failed:', err))

  return NextResponse.json({
    ok: true,
    answer,
    at: answeredAt,
    cardLast4: answer === 'CARD' ? (card?.last4 ?? null) : null,
    payDetailsLink,
    bankDueBy,
  })
}

async function notifyBilling(args: {
  answer: 'CARD' | 'BANK'
  fi: NonNullable<Awaited<ReturnType<typeof loadByToken>>>
  cardDesc: string | null
  note: string | null
  bankDueBy: string | null
}) {
  const to = await channelRecipients('invoice-billing-cc')
  if (to.length === 0) return
  const { fi } = args
  const amount = money(Number(fi.amount))
  const who = fi.job.company?.name ? `${fi.job.company.name} — ` : ''
  const inv = fi.invoiceNumber ? ` (invoice ${fi.invoiceNumber})` : ''
  const subject =
    args.answer === 'CARD'
      ? `Approved to charge · ${who}${fi.job.name} · ${amount}`
      : `Paying by bank · ${who}${fi.job.name} · ${amount}`
  const lines =
    args.answer === 'CARD'
      ? [
          `${fi.emailedTo ?? 'The client'} approved the card charge for ${fi.job.name}${inv}: ${amount} on ${args.cardDesc ?? 'the card on file'}, plus the processing fee.`,
          '',
          'Charge it from the Collections desk — the row is marked "approved to charge":',
          'https://hq.sirreel.com/collections',
        ]
      : [
          `${fi.emailedTo ?? 'The client'} chose to pay ${fi.job.name}${inv} by ACH or check: ${amount}, no fee.`,
          args.bankDueBy ? `Due by ${args.bankDueBy} (3 business days from the invoice email).` : '',
          '',
          'The Collections row shows the window. Log the proof of remittance when they send it, and mark it collected when it lands:',
          'https://hq.sirreel.com/collections',
        ]
  const text = [
    ...lines,
    ...(args.note ? ['', `Their note: "${args.note}"`] : []),
    '',
    `Job ${fi.job.jobCode}: https://hq.sirreel.com/jobs/${fi.job.id}`,
  ]
    .filter((l) => l !== null)
    .join('\n')

  await sendAgreementEmail({
    to,
    // Reply goes to the client, so "great, running it now" is one keystroke.
    replyTo: fi.emailedTo ?? undefined,
    subject,
    text,
    html: `<pre style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap;">${text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</pre>`,
    label: 'final-invoice-client-answer',
  })
}
