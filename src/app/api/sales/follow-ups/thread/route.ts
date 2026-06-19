/**
 * GET /api/sales/follow-ups/thread?orderId=X
 *
 * Returns the read-only context the Follow-ups drawer needs:
 *   - `messages`: ThreadMessage-shape rows synthesized from the order's
 *     EmailDelivery audit (the original send-quote AND any prior
 *     follow-up sends), oldest first. Outbound bodies aren't stored
 *     server-side (EmailDelivery is audit-only), so `bodyText`/
 *     `bodyHtml` are null — the drawer renders subject + recipient +
 *     timestamp.
 *   - `originalQuoteFound`: true iff at least one `send-quote:*` row
 *     exists. Drives the "(original quote thread not on file)"
 *     fallback note.
 *   - `nextDue`: the soonest PENDING QuoteFollowUp row (stage +
 *     draftSubject/draftBody seed). The drawer's read-only preview
 *     calls `/send/preview` separately for the final composed body
 *     (template + recipient + portal-link shape) — this seed is just
 *     for the cadence stage label.
 *
 * NOTE: composeFollowUpEmail re-renders the body from the stage
 * template at /send time and does NOT read QuoteFollowUp.draftSubject/
 * draftBody. Read-only preview ships now; edit-then-send is deferred
 * (requires either accepting subject/body overrides in /send or
 * persisting edits + reading them in the composer — both bigger).
 *
 * Thread anchor: the original quote send is the EARLIEST
 * `send-quote:%` EmailDelivery on this order, not the most recent
 * outbound (which would miss the original context if a prior
 * follow-up has already landed).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

interface SyntheticMessage {
  id: string
  fromAddress: string
  toAddresses: string[]
  subject: string
  snippet: string | null
  bodyText: string | null
  bodyHtml: string | null
  bodySource: string | null
  attachmentCount: number
  direction: 'outbound'
  sentAt: Date
  extractedData: null
  extractionConfidence: null
  extractionRunAt: null
  inferredFormType: null
  /** What kind of audit row this synthesized message represents. The
   *  drawer can render a small badge per stage. */
  auditKind: 'send-quote' | 'follow-up'
  auditLabel: string | null
}

export async function GET(req: NextRequest) {
  const orderId = req.nextUrl.searchParams.get('orderId') || ''
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      quoteSentAt: true,
      job: { select: { name: true } },
    },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  // Pull every EmailDelivery audit row tied to this order. Two label
  // prefixes are relevant: `send-quote:*` (original + any resends) and
  // `follow-up:*` (any prior follow-up stages). Other labels (invoice
  // sends etc.) are excluded — the agent reviewing a follow-up doesn't
  // need to see invoice mails in the thread context.
  const deliveries = await prisma.emailDelivery.findMany({
    where: {
      orderId,
      OR: [{ label: { startsWith: 'send-quote:' } }, { label: { startsWith: 'follow-up:' } }],
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      subject: true,
      toAddress: true,
      ccAddresses: true,
      label: true,
      createdAt: true,
    },
  })

  const messages: SyntheticMessage[] = deliveries.map((d) => {
    const isQuote = (d.label ?? '').startsWith('send-quote:')
    return {
      id: d.id,
      fromAddress: 'notifications@sirreel.com',
      toAddresses: [d.toAddress, ...(d.ccAddresses ?? [])],
      subject: d.subject,
      snippet: d.subject,
      bodyText: null,
      bodyHtml: null,
      bodySource: null,
      attachmentCount: 0,
      direction: 'outbound' as const,
      sentAt: d.createdAt,
      extractedData: null,
      extractionConfidence: null,
      extractionRunAt: null,
      inferredFormType: null,
      auditKind: isQuote ? ('send-quote' as const) : ('follow-up' as const),
      auditLabel: d.label,
    }
  })

  const originalQuoteFound = deliveries.some((d) => (d.label ?? '').startsWith('send-quote:'))

  // Next due cadence row — soonest PENDING. The drawer renders the
  // stage label from this; the actual composed preview comes from
  // /send/preview on the client.
  const nextDue = await prisma.quoteFollowUp.findFirst({
    where: { orderId, status: 'PENDING' },
    orderBy: { dueAt: 'asc' },
    select: {
      id: true,
      stage: true,
      dueAt: true,
      draftSubject: true,
      draftBody: true,
    },
  })

  // Client-reply safety signal. The drawer can't reconstruct the
  // inbound side of the conversation (outbound sends never become
  // EmailMessage rows, so we don't have a clean thread anchor), so a
  // rep could nudge a contact who's already answered. Surface any
  // inbound message from the quote's recipient since the quote went
  // out so the drawer can warn-don't-block. CONSERVATIVE by design:
  // a `contains` match on the recipient email could catch unrelated
  // mail from the same sender on a different topic — a false "check
  // Gmail" is fine, a missed reply is not.
  let replies: {
    count: number
    latest: { subject: string; snippet: string | null; sentAt: Date } | null
  } = { count: 0, latest: null }
  const earliestQuote = deliveries.find((d) => (d.label ?? '').startsWith('send-quote:'))
  if (earliestQuote && order.quoteSentAt) {
    const recipient = earliestQuote.toAddress.toLowerCase().trim()
    const where = {
      direction: 'inbound' as const,
      sentAt: { gt: order.quoteSentAt },
      fromAddress: { contains: recipient, mode: 'insensitive' as const },
    }
    const [count, latest] = await Promise.all([
      prisma.emailMessage.count({ where }),
      prisma.emailMessage.findFirst({
        where,
        orderBy: { sentAt: 'desc' },
        select: { subject: true, snippet: true, sentAt: true },
      }),
    ])
    replies = { count, latest }
  }

  return NextResponse.json({
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      jobName: order.job?.name ?? null,
      quoteSentAt: order.quoteSentAt,
    },
    thread: null, // no EmailThread row — outbound sends aren't in EmailMessage
    messages,
    originalQuoteFound,
    nextDue,
    replies,
  })
}
