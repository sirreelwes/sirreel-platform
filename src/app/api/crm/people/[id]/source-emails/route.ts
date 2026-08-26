/**
 * GET /api/crm/people/[id]/source-emails
 *
 * The mail that produced this contact, with bodies, so a human can read
 * it and decide the role themselves.
 *
 * Wes, 2026-08-26: "it would be great to be able to look at the emails
 * that extracted a contact so that I can discern role, etc."
 *
 * The contact page already said "Captured from jose@ on Jul 6" — a
 * date and an inbox, and no way to read the thing. Meanwhile the whole
 * reason 4,400 contacts sit at role=OTHER is that no classifier could
 * tell, which makes a human reading the actual email the highest-value
 * move available. This endpoint exists to make that one click.
 *
 * Returns two merged, deduped streams, newest first:
 *
 *   1. CAPTURE rows (InquiryCapture) for this person — what the
 *      pipeline parsed and, crucially, `verdictReason`, which is the
 *      pipeline explaining its own decision. Emmett's read
 *      "production_title:art director" while his role said OTHER; that
 *      string is the fastest way to see the machine disagreeing with
 *      itself.
 *   2. INBOUND mail from this contact that produced no capture at all —
 *      a CC-harvested contact has no capture rows, and mail predating
 *      the capture pipeline has none either. Without these the panel
 *      would be empty for exactly the contacts that most need reading.
 *
 * Bodies are capped (BODY_CHARS) because a quoted reply chain can run
 * to tens of thousands of characters and this is a read-to-judge
 * surface, not an archive. The cap keeps the head AND the tail —
 * signature blocks live at the bottom, and the signature is usually
 * the answer.
 *
 * Auth: getServerSession. Read-only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const MAX_MESSAGES = 25
const BODY_CHARS = 6000

/** Keep both ends of an over-long body — the signature is at the bottom. */
function trimBody(body: string | null): { text: string; truncated: boolean } {
  const clean = (body ?? '').replace(/\r/g, '').trim()
  if (clean.length <= BODY_CHARS) return { text: clean, truncated: false }
  const head = Math.floor(BODY_CHARS * 0.6)
  const tail = BODY_CHARS - head
  return {
    text: `${clean.slice(0, head)}\n\n[ … ${clean.length - BODY_CHARS} characters trimmed … ]\n\n${clean.slice(-tail)}`,
    truncated: true,
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params

  const person = await prisma.person.findUnique({
    where: { id },
    select: { id: true, email: true, rawTitle: true, role: true, source: true },
  })
  if (!person) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const captures = await prisma.inquiryCapture.findMany({
    where: { personId: id },
    select: {
      id: true,
      inbox: true,
      verdict: true,
      verdictReason: true,
      resolution: true,
      parsedName: true,
      parsedTitle: true,
      parsedCompanyString: true,
      parsedProject: true,
      parsedPhone: true,
      enrichmentLog: true,
      emailMessageId: true,
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_MESSAGES,
  })

  const capturedMessageIds = captures.map((c) => c.emailMessageId).filter(Boolean) as string[]

  // Inbound mail from this contact. `fromAddress` is stored as
  // "Name <addr>" as often as bare, so this is a contains match — the
  // same shape the person-detail timeline already uses.
  const inbound = await prisma.emailMessage.findMany({
    where: {
      direction: 'inbound',
      duplicateOfId: null,
      fromAddress: { contains: person.email, mode: 'insensitive' },
    },
    select: {
      id: true, subject: true, sentAt: true, fromAddress: true, toAddresses: true,
      bodyText: true, snippet: true, routingHeaders: true, threadId: true,
      emailAccount: { select: { emailAddress: true } },
    },
    orderBy: { sentAt: 'desc' },
    take: MAX_MESSAGES,
  })

  // Bodies for the captured messages that aren't already in `inbound`
  // — a capture can point at mail this contact was only mentioned on.
  const missingIds = capturedMessageIds.filter((mid) => !inbound.some((m) => m.id === mid))
  const extra = missingIds.length > 0
    ? await prisma.emailMessage.findMany({
        where: { id: { in: missingIds } },
        select: {
          id: true, subject: true, sentAt: true, fromAddress: true, toAddresses: true,
          bodyText: true, snippet: true, routingHeaders: true, threadId: true,
          emailAccount: { select: { emailAddress: true } },
        },
      })
    : []

  const capturesByMessage = new Map(captures.map((c) => [c.emailMessageId, c]))

  const messages = [...inbound, ...extra]
    .map((m) => {
      const { text, truncated } = trimBody(m.bodyText ?? m.snippet)
      const cap = capturesByMessage.get(m.id)
      const rh = (m.routingHeaders ?? {}) as Record<string, unknown>
      return {
        id: m.id,
        subject: m.subject,
        sentAt: m.sentAt,
        fromAddress: m.fromAddress,
        toAddresses: m.toAddresses,
        cc: typeof rh.cc === 'string' ? rh.cc : null,
        inbox: m.emailAccount.emailAddress,
        threadId: m.threadId,
        body: text,
        truncated,
        hasBody: !!(m.bodyText && m.bodyText.trim().length > 0),
        // What the pipeline made of THIS message, when it looked at it.
        capture: cap
          ? {
              verdict: cap.verdict,
              verdictReason: cap.verdictReason,
              resolution: cap.resolution,
              inbox: cap.inbox,
              parsedTitle: cap.parsedTitle,
              parsedCompanyString: cap.parsedCompanyString,
              parsedProject: cap.parsedProject,
              parsedPhone: cap.parsedPhone,
              enrichmentLog: cap.enrichmentLog,
            }
          : null,
      }
    })
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
    .slice(0, MAX_MESSAGES)

  // Captures whose message row is gone (deleted / never synced) still
  // carry what was parsed, so report the count rather than pretending
  // the contact has less provenance than it does.
  const orphanCaptures = captures.filter(
    (c) => !messages.some((m) => m.id === c.emailMessageId),
  ).length

  return NextResponse.json({
    personId: person.id,
    currentRole: person.role,
    rawTitle: person.rawTitle,
    source: person.source,
    captureCount: captures.length,
    orphanCaptures,
    messages,
  })
}
