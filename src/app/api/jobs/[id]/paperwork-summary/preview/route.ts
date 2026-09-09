/**
 * POST /api/jobs/[id]/paperwork-summary/preview — pure preview, no writes.
 *
 * Feeds EmailReviewModal for the job page's "Send summary" button on the
 * Paperwork strip. NOTHING is minted here: the client's magic link is
 * issued at send time, so the preview renders the checklist rows without
 * live buttons (portalUrlIsTokenized: false) rather than with dead ones.
 *
 * Body (optional): { message?, customMessage?, overrideContactId? }
 * Auth: session-gated.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { composePaperworkSummaryEmail } from '@/lib/email/preview/composePaperworkSummaryEmail'

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
  const customMessage =
    typeof body?.customMessage === 'string' && body.customMessage.trim().length > 0
      ? body.customMessage.trim().slice(0, 5000)
      : null
  const overrideContactId =
    typeof body?.overrideContactId === 'string' ? body.overrideContactId : null

  const composition = await composePaperworkSummaryEmail({
    jobId: params.id,
    message,
    customMessage,
    overrideContactId,
    links: null,
  })
  if (!composition.ok) return bad(composition.status, composition.error)

  return NextResponse.json(composition)
}
