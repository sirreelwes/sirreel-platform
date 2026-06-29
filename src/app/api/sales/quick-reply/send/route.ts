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
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
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
  })

  const result = await sendAgreementEmail({
    to: [payload.recipientEmail],
    subject,
    html,
    text,
    attachments: [],
    label: 'quick-reply',
  })
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason || 'send failed' }, { status: 502 })
  }
  return NextResponse.json({ ok: true, recipient: payload.recipientEmail, order: { orderNumber: 'Quick reply' } })
}
