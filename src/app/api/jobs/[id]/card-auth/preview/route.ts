/**
 * POST /api/jobs/[id]/card-auth/preview — pure preview, no writes.
 *
 * Feeds EmailReviewModal for the job page's Card Authorization tile. NO
 * PaperworkRequest is minted here: the token is created at send time, so
 * the preview body renders the portal CTA as an annotation rather than a
 * live button (portalUrlIsTokenized: false).
 *
 * Body (optional): { message?: string, customMessage?: string, overrideContactId?: string }
 * Auth: session-gated.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { composeCardAuthEmail } from '@/lib/email/preview/composeCardAuthEmail'

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
  // "Write my own email" — replaces the templated ask and its closer.
  const customMessage =
    typeof body?.customMessage === 'string' && body.customMessage.trim().length > 0
      ? body.customMessage.trim().slice(0, 5000)
      : null

  const composition = await composeCardAuthEmail({
    jobId: params.id,
    message,
    customMessage,
    overrideContactId,
    portalLink: null,
  })

  if (!composition.ok) return bad(composition.status, composition.error)

  return NextResponse.json(composition)
}
