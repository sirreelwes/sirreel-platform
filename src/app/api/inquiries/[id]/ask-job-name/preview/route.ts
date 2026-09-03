/**
 * POST /api/inquiries/[id]/ask-job-name/preview — composes the "what should
 * we call this job?" draft for EmailReviewModal. NO send, NO writes, MINTS
 * NOTHING: the preview's link is a placeholder token (the modal's iframe is
 * sandboxed and inert anyway); the real signed link is minted only by the
 * send route.
 *
 * Body: { toEmail?, toName?, askForCompany?, customMessage? }
 * Returns the CompositionOk shape EmailReviewModal renders.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { SEND_FROM } from '@/lib/email/sendAgreementEmail'
import { detailsLinkUrl } from '@/lib/intake/detailsToken'
import {
  askJobNameDefaultBody,
  composeAskJobNameEmail,
  loadAskJobNameContext,
} from '@/lib/sales/askJobNameEmail'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true, email: true },
  })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  try {
    const ctx = await loadAskJobNameContext(id, user, body)
    const customMessage =
      typeof body.customMessage === 'string' && body.customMessage.trim()
        ? body.customMessage
        : null
    const { subject, html, text } = composeAskJobNameEmail({
      ctx,
      url: detailsLinkUrl('preview-not-a-real-token'),
      customMessage,
    })
    return NextResponse.json({
      ok: true,
      defaultBody: askJobNameDefaultBody(ctx.askForCompany),
      to: { id: '', name: ctx.toName, email: ctx.toEmail, role: null, isPrimary: true },
      alternatives: [],
      from: SEND_FROM,
      subject,
      html,
      text,
      attachments: [],
      // Synthetic order block — EmailReviewModal expects one and there is no
      // order yet; this ask is what happens BEFORE the quote is saved.
      order: { id: '', orderNumber: 'Job name', jobName: ctx.inquiryTitle, portalSlug: null },
      portalUrlIsTokenized: false,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Preview failed'
    return NextResponse.json({ ok: false, error: msg }, { status: msg === 'Inquiry not found' ? 404 : 400 })
  }
}
