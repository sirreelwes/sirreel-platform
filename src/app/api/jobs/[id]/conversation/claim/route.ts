import { NextRequest, NextResponse } from 'next/server'
import { applyClaimForJob, conversationActor } from '@/lib/email/jobConversation'
import type { ClaimAction, ConversationLane } from '@/lib/email/conversationRules'

export const dynamic = 'force-dynamic'

const LANES = new Set<string>(['SALES', 'BILLING'])

/**
 * POST /api/jobs/[id]/conversation/claim — who is answering.
 *   { action: 'claim' }                      → "<me> is answering"
 *   { action: 'hand', lane: 'BILLING' }      → "Handed to Billing" (+ the billing ping)
 *   { action: 'hand', lane: 'SALES' }        → "Handed to Sales"
 *   { action: 'release' }                    → nothing
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await conversationActor()
  if (!me) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const payload = (await req.json().catch(() => ({}))) as { action?: unknown; lane?: unknown }
  const lane = typeof payload.lane === 'string' && LANES.has(payload.lane) ? (payload.lane as ConversationLane) : null

  let action: ClaimAction
  if (payload.action === 'claim') action = { action: 'claim', userId: me.id, lane: lane ?? undefined }
  else if (payload.action === 'hand') {
    if (!lane) return NextResponse.json({ ok: false, error: 'lane must be SALES or BILLING' }, { status: 400 })
    action = { action: 'hand', lane }
  } else if (payload.action === 'release') action = { action: 'release' }
  else return NextResponse.json({ ok: false, error: 'action must be claim, hand or release' }, { status: 400 })

  const r = await applyClaimForJob({ jobId: params.id, actor: me, action })
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, claim: r.claim, notified: r.notified })
}
