/** PATCH /api/vermar/leads/[id] { contacted } — VerMar marks a request worked. */
import { NextRequest, NextResponse } from 'next/server'
import { requireVerMarOperator, operatorErrorResponse } from '@/lib/hq-white-label/operatorGate'
import { setLeadContacted } from '@/lib/hq-white-label/leads'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireVerMarOperator()
  if (gate instanceof NextResponse) return gate
  const b = (await req.json().catch(() => ({}))) as { contacted?: unknown }
  try {
    await setLeadContacted(params.id, b.contacted === true, gate.user.email)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return operatorErrorResponse(e)
  }
}
