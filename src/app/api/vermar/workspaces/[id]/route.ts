/** PATCH /api/vermar/workspaces/[id] — status / plan / trial end. VerMar operators. */
import { NextRequest, NextResponse } from 'next/server'
import { requireVerMarOperator, operatorErrorResponse } from '@/lib/hq-white-label/operatorGate'
import { operatorUpdateWorkspace } from '@/lib/hq-white-label/operator'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireVerMarOperator()
  if (gate instanceof NextResponse) return gate
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  try {
    await operatorUpdateWorkspace(params.id, { status: b.status, plan: b.plan, trialEndsAt: b.trialEndsAt }, gate.user)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return operatorErrorResponse(e)
  }
}
