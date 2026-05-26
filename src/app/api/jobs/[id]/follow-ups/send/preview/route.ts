/**
 * POST /api/jobs/[id]/follow-ups/send/preview — job-scoped pure preview.
 *
 * Mirrors the job-scoped send wrapper: resolves the Job's latest
 * QUOTE_SENT Order, then delegates to the per-order preview. Job→Order
 * resolution shared with the send wrapper via
 * resolveJobLatestSentOrder so the two surfaces can't pick different
 * orders.
 *
 * Used by the pipeline Kanban's Nudge button — opens the modal with
 * { kind: 'job', id } and the modal POSTs here to fetch the preview.
 *
 * Body (optional): { message?: string } — relayed straight through.
 * Auth: session-gated.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { composeFollowUpEmail } from '@/lib/email/preview/composeFollowUpEmail'
import { resolveJobLatestSentOrder } from '@/lib/sales/resolveJobLatestSentOrder'

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

  const order = await resolveJobLatestSentOrder(params.id)
  if (!order) {
    return bad(409, 'no SENT order on this job — nothing to follow up on')
  }

  const composition = await composeFollowUpEmail({
    orderId: order.id,
    stage: null,
    message,
    overrideContactId,
    portalUrl: null,
  })

  if (!composition.ok) {
    return bad(composition.status, composition.error)
  }

  return NextResponse.json(composition)
}
