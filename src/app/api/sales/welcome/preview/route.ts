import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { SEND_FROM } from '@/lib/email/sendAgreementEmail'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'
import {
  loadWelcomeInquiryContext,
  composeWelcomeEmail,
  welcomeInviteUrl,
} from '@/lib/sales/welcomeEmail'

export const dynamic = 'force-dynamic'

/**
 * POST /api/sales/welcome/preview — composes the Welcome / Job Begin draft
 * for EmailReviewModal. NO send, NO writes, MINTS NOTHING: the CTA link in
 * the preview carries a placeholder token (the sandboxed preview iframe is
 * inert anyway); the real WelcomeInvite token is minted only by /send.
 *
 * Body: { inquiryId, message? (personal note), customMessage? (write-my-own) }
 * Returns the CompositionOk shape EmailReviewModal renders.
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
    const { subject, html, text } = composeWelcomeEmail({
      ctx,
      // Placeholder — never resolvable; the live token exists only after Send.
      inviteUrl: welcomeInviteUrl('preview-not-a-real-token'),
      personalNote: message,
      customMessage,
    })
    return NextResponse.json({
      ok: true,
      to: { id: ctx.person.id, name: ctx.person.firstName, email: ctx.person.email, role: null, isPrimary: true },
      alternatives: [],
      from: SEND_FROM,
      subject,
      html,
      text,
      attachments: [],
      // Synthetic order block (EmailReviewModal expects one; no order exists —
      // that is the whole point of the click-to-create invite).
      order: { id: '', orderNumber: 'Welcome', jobName: ctx.inquiryTitle, portalSlug: null },
      portalUrlIsTokenized: false,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Preview failed'
    return NextResponse.json({ ok: false, error: msg }, { status: msg === 'Inquiry not found' ? 404 : 400 })
  }
}
