/**
 * GET /api/incidents/email/[id]
 *
 * Lazily fetches a single EmailMessage's body for the
 * IncidentEmailDrawer. Returns just the fields the drawer renders
 * (body + the header bits the parse-summary card supplements) — NOT
 * the surrounding Gmail thread. The parent incident GET already
 * carries enough metadata for the per-email summary list; this
 * endpoint adds the body when the rep opens one.
 *
 * Auth: any authenticated session. Matches the parent
 * GET /api/incidents/[id] gate — the drawer is shown to everyone
 * who can already see the per-email summary list. PATCH-style
 * mutations (severity / assignee etc.) stay gated through
 * requireIncidentEditAccess on the [id]/route.ts PATCH.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const email = await prisma.emailMessage.findUnique({
    where: { id },
    select: {
      id: true,
      gmailMessageId: true,
      rfc822MessageId: true,
      threadId: true,
      fromAddress: true,
      toAddresses: true,
      subject: true,
      snippet: true,
      bodyText: true,
      bodyHtml: true,
      bodySource: true,
      attachmentCount: true,
      direction: true,
      sentAt: true,
      // Inbox the message landed in — drives the Gmail deep-link's
      // `/u/<email>/` authuser hint when ClaimMail.inbox isn't cached.
      emailAccount: { select: { emailAddress: true } },
    },
  })
  if (!email) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  return NextResponse.json({ email })
}
