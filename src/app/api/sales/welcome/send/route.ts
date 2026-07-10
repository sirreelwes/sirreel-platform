import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import {
  loadWelcomeInquiryContext,
  composeWelcomeEmail,
  welcomeInviteUrl,
  WELCOME_INVITE_TTL_DAYS,
} from '@/lib/sales/welcomeEmail'

export const dynamic = 'force-dynamic'

/**
 * POST /api/sales/welcome/send — the explicit confirm-send behind the
 * EmailReviewModal Send button (preview never sends).
 *
 * Creates/refreshes the ONE WelcomeInvite for the inquiry (256-bit token,
 * 7-day expiry; inquiryId is @unique so a re-send refreshes the same row and
 * invalidates the old token), composes the SAME body the agent reviewed
 * (personal note + write-my-own customMessage) with the "Get Paperwork
 * Started" CTA, and dispatches via sendAgreementEmail.
 *
 * DESIGN RULE: NO Job/Order/portal is created here — those are minted only
 * when the client presses the button on /portal/welcome/[token]. A re-send
 * after the invite was used is refused (the job already exists).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const actor = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
  if (!actor || !can(actor.role, 'canCreateBooking')) {
    return NextResponse.json({ ok: false, error: 'sending a welcome is a sales action' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const inquiryId = typeof body.inquiryId === 'string' ? body.inquiryId : ''
  if (!inquiryId) return NextResponse.json({ ok: false, error: 'inquiryId required' }, { status: 400 })
  const message: string | null = typeof body.message === 'string' && body.message.trim() ? body.message : null
  const customMessage: string | null =
    typeof body.customMessage === 'string' && body.customMessage.trim() ? body.customMessage : null

  try {
    const ctx = await loadWelcomeInquiryContext(inquiryId, session.user.email)

    // Pin the agent on the inquiry if unassigned — the click-time Job create
    // needs a deterministic agentId, and "acting on it assigns it to you" is
    // the standard triage behavior. No-op when already assigned.
    await prisma.inquiry.updateMany({
      where: { id: inquiryId, assignedToId: null },
      data: { assignedToId: ctx.agent.id },
    })

    // One invite per inquiry: upsert refreshes token + expiry on re-send
    // (old emailed link dies, the new one carries the fresh token). If the
    // invite was already USED, the job exists — refuse rather than re-invite.
    const existing = await prisma.welcomeInvite.findUnique({
      where: { inquiryId },
      select: { id: true, usedAt: true, createdJobId: true },
    })
    if (existing?.usedAt || existing?.createdJobId) {
      return NextResponse.json(
        { ok: false, error: 'The client already started paperwork from this invite — the job exists.' },
        { status: 409 },
      )
    }
    const token = randomBytes(32).toString('hex') // 256-bit
    const expiresAt = new Date(Date.now() + WELCOME_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)
    await prisma.welcomeInvite.upsert({
      where: { inquiryId },
      create: { token, inquiryId, personId: ctx.person.id, expiresAt },
      update: { token, personId: ctx.person.id, expiresAt },
    })

    const { subject, html, text } = composeWelcomeEmail({
      ctx,
      inviteUrl: welcomeInviteUrl(token),
      personalNote: message,
      customMessage,
    })
    const result = await sendAgreementEmail({
      to: [ctx.person.email],
      subject,
      html,
      text,
      attachments: [],
      label: 'welcome-invite',
    })
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason || 'send failed' }, { status: 502 })
    }

    return NextResponse.json({ ok: true, recipient: ctx.person.email, order: { orderNumber: 'Welcome' } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Send failed'
    return NextResponse.json({ ok: false, error: msg }, { status: msg === 'Inquiry not found' ? 404 : 400 })
  }
}
