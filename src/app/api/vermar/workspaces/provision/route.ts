/** POST /api/vermar/workspaces/provision { vendorId } — VerMar starts a trial
 *  for a partner. Emails the partner's contact their link. VerMar operators. */
import { NextRequest, NextResponse } from 'next/server'
import { requireVerMarOperator, operatorErrorResponse } from '@/lib/hq-white-label/operatorGate'
import { operatorProvisionWorkspace } from '@/lib/hq-white-label/operator'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requireVerMarOperator()
  if (gate instanceof NextResponse) return gate
  const b = (await req.json().catch(() => ({}))) as { vendorId?: unknown }
  if (typeof b.vendorId !== 'string' || !b.vendorId) return NextResponse.json({ error: 'vendorId required' }, { status: 400 })
  try {
    return NextResponse.json({ ok: true, url: await operatorProvisionWorkspace(b.vendorId, gate.user) }, { status: 201 })
  } catch (e) {
    return operatorErrorResponse(e)
  }
}
