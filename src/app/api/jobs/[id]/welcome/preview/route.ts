/**
 * POST /api/jobs/[id]/welcome/preview — pure preview, no writes.
 *
 * Feeds EmailReviewModal for "Send welcome email" on the job page. NOTHING
 * is minted here: the client's magic link is issued at send time, so the
 * button renders inert (portalUrlIsTokenized: false).
 *
 * Body (optional): { customMessage?, overrideContactId? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { composeJobWelcomeEmail } from '@/lib/email/preview/composeJobWelcomeEmail'

export const dynamic = 'force-dynamic'

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return bad(401, 'unauthorized')

  const body = await req.json().catch(() => ({}))
  const customMessage =
    typeof body?.customMessage === 'string' && body.customMessage.trim().length > 0
      ? body.customMessage.trim().slice(0, 5000)
      : null
  const overrideContactId =
    typeof body?.overrideContactId === 'string' ? body.overrideContactId : null

  const composition = await composeJobWelcomeEmail({
    jobId: params.id,
    customMessage,
    overrideContactId,
    portalLink: null,
  })
  if (!composition.ok) return bad(composition.status, composition.error)

  return NextResponse.json(composition)
}
