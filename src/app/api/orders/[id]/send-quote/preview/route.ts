/**
 * POST /api/orders/[id]/send-quote/preview — pure preview.
 *
 * Returns the composed quote email exactly as the agent's "Send" click
 * would dispatch it — except the portal CTA is rendered tokenless (the
 * magic-link mint is a write, kept out of preview). NO Resend dispatch,
 * NO state writes, NO PortalAccess mutation, NO PDF buffer fetch.
 *
 * Body (optional): { message?: string } — same shape as the send route.
 * Response: { ok: true, to, alternatives, from, subject, html, text,
 *             attachments[], order, portalUrlIsTokenized: false }
 *
 * Auth: session-gated (agent-only). No rate limit — agents already
 * authenticated through the dashboard.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { composeQuoteEmail } from '@/lib/email/preview/composeQuoteEmail'

export const dynamic = 'force-dynamic'

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return bad(401, 'unauthorized')

  const body = await req.json().catch(() => ({}))
  const message =
    typeof body?.message === 'string' && body.message.trim().length > 0
      ? body.message.trim().slice(0, 5000)
      : null
  const overrideContactId =
    typeof body?.overrideContactId === 'string' ? body.overrideContactId : null

  const composition = await composeQuoteEmail({
    orderId: params.id,
    message,
    overrideContactId,
    portalUrl: null, // preview ⇒ tokenless CTA href; modal annotates
    includeAttachmentMeta: true,
  })

  if (!composition.ok) {
    return bad(composition.status, composition.error)
  }

  return NextResponse.json(composition)
}
