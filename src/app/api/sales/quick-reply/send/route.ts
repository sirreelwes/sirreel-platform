/**
 * POST /api/sales/quick-reply/send — composes the Quick Reply (recomputing
 * availability from the real engine) and dispatches it via the same
 * sendAgreementEmail path as quote/follow-up emails. No quote PDF, no
 * attachments. Soft holds (if any) are created separately by the Quick Reply
 * UI through the existing POST /api/scheduling/holds path — not here.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { parseCcList } from '@/lib/email/ccList'
import { agentReplyTo, withTeamCc } from '@/lib/email/teamVisibility'
import {
  computeQuickReplyTiering,
  composeQuickReply,
  quickReplySendSubject,
} from '@/lib/sales/quickReply'
import { captureOutreachContact } from '@/lib/crm/captureFromEmail'
import { recordQuickReplyOnThread } from '@/lib/sales/markInquiryResponded'
import { autoReplySubjectMarker } from '@/lib/email/autoReply'
import { buildDetailsLink } from '@/lib/intake/detailsLink'
import { threadingForReplyTo } from '@/lib/email/threadingHeaders'

export const dynamic = 'force-dynamic'

interface QuickReplyPayload {
  recipientEmail: string
  recipientName: string | null
  clientName: string | null
  jobName: string | null
  pickup: string | null
  return: string | null
  categories: { id: string; name: string; quantity: number; startDate?: string; endDate?: string }[]
  /** Supplies / gear the client asked to come on the vehicle. Not holdable
   *  (no Asset units behind expendables) — they ride on the reply and on the
   *  hold's notes instead. */
  supplies?: { name: string; quantity: number }[]
  askForDetails?: boolean
  /** Window of the soft hold the agent just created (never unit names). */
  heldFrom?: string | null
  heldTo?: string | null
  customMessage?: string | null
  /** EmailMessage id of the inbound being replied to — drives CRM capture. */
  inboundEmailMessageId?: string | null
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  // Rep-typed CC from the review modal. Re-parsed server-side: the
  // client-side check is a convenience, not a control.
  const manualCc = parseCcList(body.ccAdd)
  const payload = body.payload as QuickReplyPayload | undefined
  if (!payload?.recipientEmail) {
    return NextResponse.json({ ok: false, error: 'recipient email required' }, { status: 400 })
  }
  const message: string | null = typeof body.message === 'string' ? body.message : null

  // Send-time double-reply guard. Between the card render and this click,
  // the thread may have gone OUTBOUND-last (another agent's Quick Reply, or
  // a Gmail-synced staff reply). Stop with 409 { alreadyReplied } so the
  // review modal can ask "send anyway?" — a confirmed resubmit carries
  // confirmDuplicate: true and skips the check.
  if (payload.inboundEmailMessageId && body.confirmDuplicate !== true) {
    try {
      const inbound = await prisma.emailMessage.findUnique({
        where: { id: payload.inboundEmailMessageId },
        select: { threadId: true },
      })
      if (inbound?.threadId) {
        const thread = await prisma.emailThread.findUnique({
          where: { id: inbound.threadId },
          select: { id: true, lastDirection: true, lastOutboundAt: true },
        })
        if (thread?.lastDirection === 'OUTBOUND') {
          // The last outbound must be a HUMAN one. An out-of-office is not
          // another agent's reply, and blocking a Quick Reply because the
          // vacation responder fired is exactly backwards — the client is
          // still waiting. Threads stamped before the ingest fix still carry
          // the responder's timestamp, so re-check the message itself.
          const lastOut = await prisma.emailMessage.findFirst({
            where: { threadId: thread.id, direction: 'outbound', autoReply: false },
            orderBy: { sentAt: 'desc' },
            select: { fromAddress: true, sentAt: true, subject: true },
          })
          if (lastOut && !autoReplySubjectMarker(lastOut.subject)) {
            return NextResponse.json(
              {
                ok: false,
                error: 'already-replied',
                alreadyReplied: {
                  by: lastOut.fromAddress,
                  at: lastOut.sentAt.toISOString(),
                },
              },
              { status: 409 },
            )
          }
        }
      }
    } catch (err) {
      // Guard is advisory — never block a legitimate send on a check error.
      console.warn('[quick-reply send] already-replied guard failed (non-blocking):', err)
    }
  }

  // The inbound being answered — its Message-ID is what makes this send
  // a reply rather than a new conversation. Read once here; the send and
  // the thread record below both need it. Best-effort: a missing parent
  // just means no threading, never a failed reply.
  const inboundParent = payload.inboundEmailMessageId
    ? await prisma.emailMessage
        .findUnique({
          where: { id: payload.inboundEmailMessageId },
          select: { rfc822MessageId: true, inReplyTo: true, subject: true },
        })
        .catch(() => null)
    : null

  const tiering = await computeQuickReplyTiering(payload.categories || [], payload.pickup, payload.return)

  // One-tap link for the "what's the production company / project name?"
  // ask. Minted here, not in the modal, so the token is signed server-side
  // and bound to the inquiry we can actually resolve. Null when nothing
  // binds — the ask then keeps its plain "just reply with those" wording.
  const askForCompany = !!payload.askForDetails && !payload.clientName?.trim()
  const askForProject = !!payload.askForDetails && !payload.jobName?.trim()
  const detailsUrl = await buildDetailsLink({
    askForCompany,
    askForProject,
    sentTo: payload.recipientEmail,
    inboundEmailMessageId: payload.inboundEmailMessageId ?? null,
  })

  const { subject, html, text } = composeQuickReply({
    recipientName: payload.recipientName,
    clientName: payload.clientName,
    jobName: payload.jobName,
    pickup: payload.pickup,
    ret: payload.return,
    tiering,
    agentName: session.user.name || 'SirReel',
    personalNote: message,
    askForDetails: !!payload.askForDetails,
    detailsUrl,
    heldFrom: typeof payload.heldFrom === 'string' ? payload.heldFrom : null,
    heldTo: typeof payload.heldTo === 'string' ? payload.heldTo : null,
    // Named in the email so the client can check we heard the request right.
    categories: payload.categories || [],
    supplies: Array.isArray(payload.supplies) ? payload.supplies : [],
    customMessage: payload.customMessage ?? null,
  })

  // Team visibility (see lib/email/teamVisibility.ts):
  //   · CC the 'sales-team-cc' notification channel. That was the whole
  //     desk until Wes's 2026-09-08 quiet-down pass and is Wes alone now;
  //     the desk sees the reply on the /jobs incoming board instead, via
  //     recordQuickReplyOnThread below.
  //   · Reply-To the SENDING AGENT, never a group: groups commonly reject
  //     non-member mail, so pointing a client's reply there risks a
  //     bounce. Agent mailboxes ARE ingested by HQ, so the reply reaches
  //     a person and flows back in. Previously there was no Reply-To at
  //     all and replies went to notifications@, which nobody works.
  const ccList = await withTeamCc(manualCc, payload.recipientEmail)
  const replyTo = agentReplyTo(session.user.email)

  // ── Conversation threading (Wes 2026-09-08) ─────────────────────────
  // "If someone starts a reply from incoming email … can it somehow stay
  // in the same incoming email thread?" It could not: this send carried
  // no In-Reply-To, no References and no Message-ID, so it arrived in the
  // client's inbox as a NEW conversation next to the one they wrote.
  //
  // EmailMessage stores the parent's Message-ID and its In-Reply-To but
  // not its full References chain, so the chain we can honestly rebuild
  // is [parent's parent, parent] — two hops. That is what Gmail and
  // Outlook actually match on, and buildReferences drops anything
  // malformed rather than guessing.
  //
  // The subject is re-derived as "Re: <their subject>" by
  // quickReplySendSubject — same helper the preview route uses, so what
  // the agent approved is what goes out.
  const threading = inboundParent
    ? threadingForReplyTo({
        kind: 'quick-reply',
        parentMessageId: inboundParent.rfc822MessageId,
        parentReferences: inboundParent.inReplyTo,
      })
    : undefined
  // Shared with the preview route — the agent approves a subject, so the
  // two must never compute it differently.
  const sendSubject = quickReplySendSubject(subject, inboundParent?.subject)

  const result = await sendAgreementEmail({
    to: [payload.recipientEmail],
    cc: ccList.length > 0 ? ccList : undefined,
    replyTo: replyTo ?? undefined,
    subject: sendSubject,
    html,
    text,
    attachments: [],
    label: 'quick-reply',
    threading,
  })
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason || 'send failed' }, { status: 502 })
  }

  // Thread + inquiry convergence — BEST-EFFORT. Quick Replies go out via
  // Resend and never hit Gmail, so record the reply on the inbound's
  // thread ourselves (thread view completeness) and mark linked open
  // inquiries responded, attributed to the logged-in agent. Same
  // mechanism the Gmail ingest reply-detection uses.
  if (payload.inboundEmailMessageId) {
    await recordQuickReplyOnThread({
      inboundEmailMessageId: payload.inboundEmailMessageId,
      staffEmail: session.user.email,
      recipientEmail: payload.recipientEmail,
      subject: sendSubject,
      bodyText: text ?? null,
      bodyHtml: html ?? null,
      // Store the Message-ID this actually went out under. The client's
      // reply carries it as In-Reply-To, and hasKnownConversationLink
      // (ingestFilter) matches exactly this column — so an HQ-sent
      // conversation becomes provably ours for the first time.
      rfc822MessageId: result.messageId,
      inReplyTo: threading?.inReplyTo ?? null,
    })
  }

  // CRM capture — BEST-EFFORT, never blocks the reply. The send already
  // succeeded above; a capture failure is logged and swallowed (and
  // captureOutreachContact itself never throws past its boundary).
  let capture: Awaited<ReturnType<typeof captureOutreachContact>> | null = null
  if (payload.inboundEmailMessageId) {
    try {
      capture = await captureOutreachContact({
        emailMessageId: payload.inboundEmailMessageId,
        companyNameHint: payload.clientName,
        projectHint: payload.jobName,
      })
    } catch (err) {
      console.error('[quick-reply send] CRM capture failed (non-blocking):', err)
    }
  }

  return NextResponse.json({ ok: true, recipient: payload.recipientEmail, order: { orderNumber: 'Quick reply' }, capture })
}
