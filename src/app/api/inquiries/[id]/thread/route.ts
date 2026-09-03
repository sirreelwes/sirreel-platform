import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/inquiries/[id]/thread — the originating email for an Inquiry.
 *
 * Exists so a surface that must NOT navigate away (the new-quote review
 * step, where leaving loses unsaved line-item edits) can show the client's
 * original message in a drawer. /api/sales/inquiries/thread does the same
 * job but is keyed by EmailMessage.id; only the inquiry id is in hand here.
 *
 * Resolution mirrors attachInquiryThreadToJob: sourceMetadata.emailMessageId
 * first, then rfc822MessageId (cross-inbox copies share it). A WEB_FORM or
 * MANUAL inquiry has no email at all — `messages` comes back empty and the
 * caller falls back to the inquiry's own description.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params

  const inquiry = await prisma.inquiry.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      source: true,
      createdAt: true,
      rfc822MessageId: true,
      sourceMetadata: true,
    },
  })
  if (!inquiry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const meta = inquiry.sourceMetadata as Record<string, unknown> | null
  const emailMessageId = typeof meta?.emailMessageId === 'string' ? meta.emailMessageId : null

  const messageSelect = {
    id: true,
    fromAddress: true,
    toAddresses: true,
    subject: true,
    snippet: true,
    bodyText: true,
    bodyHtml: true,
    attachmentCount: true,
    direction: true,
    sentAt: true,
  } as const

  let anchor = emailMessageId
    ? await prisma.emailMessage.findUnique({
        where: { id: emailMessageId },
        select: { id: true, threadId: true },
      })
    : null
  if (!anchor && inquiry.rfc822MessageId) {
    anchor = await prisma.emailMessage.findFirst({
      where: { rfc822MessageId: inquiry.rfc822MessageId },
      orderBy: { sentAt: 'asc' },
      select: { id: true, threadId: true },
    })
  }

  let thread: { id: string; subject: string | null } | null = null
  let messages: Array<Record<string, unknown>> = []

  if (anchor?.threadId) {
    const [t, msgs] = await Promise.all([
      prisma.emailThread.findUnique({
        where: { id: anchor.threadId },
        select: { id: true, subject: true },
      }),
      prisma.emailMessage.findMany({
        where: { threadId: anchor.threadId },
        orderBy: { sentAt: 'asc' },
        select: messageSelect,
      }),
    ])
    thread = t
    messages = msgs
  } else if (anchor) {
    const single = await prisma.emailMessage.findUnique({
      where: { id: anchor.id },
      select: messageSelect,
    })
    if (single) messages = [single]
  }

  return NextResponse.json({
    inquiry: {
      id: inquiry.id,
      title: inquiry.title,
      description: inquiry.description,
      source: inquiry.source,
      createdAt: inquiry.createdAt,
    },
    thread,
    anchorMessageId: anchor?.id ?? null,
    messages,
  })
}
