/**
 * POST /api/sales/quick-reply/preview — composes the Quick Reply draft for
 * EmailReviewModal. NO send, no writes. Recomputes availability from the real
 * engine each time so the body always reflects current numbers. Returns the
 * same CompositionOk shape EmailReviewModal renders (synthetic order — Quick
 * Reply has no order yet).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { SEND_FROM } from '@/lib/email/sendAgreementEmail'
import { computeQuickReplyAvailability, composeQuickReply } from '@/lib/sales/quickReply'

export const dynamic = 'force-dynamic'

interface QuickReplyPayload {
  recipientEmail: string
  recipientName: string | null
  clientName: string | null
  jobName: string | null
  pickup: string | null
  return: string | null
  categories: { id: string; name: string; quantity: number }[]
  askForDetails?: boolean
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const payload = body.payload as QuickReplyPayload | undefined
  if (!payload?.recipientEmail) {
    return NextResponse.json({ ok: false, error: 'recipient email required' }, { status: 400 })
  }
  const message: string | null = typeof body.message === 'string' ? body.message : null

  const lines = await computeQuickReplyAvailability(payload.categories || [], payload.pickup, payload.return)
  const { subject, html, text } = composeQuickReply({
    recipientName: payload.recipientName,
    clientName: payload.clientName,
    jobName: payload.jobName,
    pickup: payload.pickup,
    ret: payload.return,
    lines,
    agentName: session.user.name || 'SirReel',
    personalNote: message,
    askForDetails: !!payload.askForDetails,
  })

  return NextResponse.json({
    ok: true,
    to: { id: '', name: payload.recipientName || payload.recipientEmail, email: payload.recipientEmail, role: null, isPrimary: true },
    alternatives: [],
    from: SEND_FROM,
    subject,
    html,
    text,
    attachments: [],
    order: { id: '', orderNumber: 'Quick reply', jobName: payload.jobName ?? null, portalSlug: null },
    portalUrlIsTokenized: false,
  })
}
