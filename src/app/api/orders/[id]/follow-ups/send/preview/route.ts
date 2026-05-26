/**
 * POST /api/orders/[id]/follow-ups/send/preview — pure preview.
 *
 * Runs the same cadence gating + recipient ranking + body render the
 * real send would, returns the composed payload, and writes nothing.
 *
 * Body (all optional):
 *   - stage: 'STAGE_1' | 'STAGE_2' | 'STAGE_3' — omit to auto-resolve
 *   - message: string — optional custom note
 *
 * Cadence failures (paused, out-of-order, no recipient) are surfaced
 * as 4xx so the modal can display "this send would be blocked
 * because X" before the agent commits.
 *
 * Auth: session-gated.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { composeFollowUpEmail } from '@/lib/email/preview/composeFollowUpEmail'
import { CADENCE_STAGES, type CadenceStage } from '@/lib/sales/quoteCadence'

export const dynamic = 'force-dynamic'

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return bad(401, 'unauthorized')

  const body = await req.json().catch(() => ({}))

  const rawStage = body?.stage
  if (
    rawStage != null &&
    (typeof rawStage !== 'string' || !CADENCE_STAGES.includes(rawStage as CadenceStage))
  ) {
    return bad(400, 'stage must be STAGE_1, STAGE_2, or STAGE_3 (or omitted for auto-resolve)')
  }
  const stage = (rawStage as CadenceStage | undefined) ?? null

  const message =
    typeof body?.message === 'string' && body.message.trim().length > 0
      ? body.message.trim().slice(0, 5000)
      : null

  const composition = await composeFollowUpEmail({
    orderId: params.id,
    stage,
    message,
    portalUrl: null,
  })

  if (!composition.ok) {
    return bad(composition.status, composition.error)
  }

  return NextResponse.json(composition)
}
