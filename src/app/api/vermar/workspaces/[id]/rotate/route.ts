/** POST /api/vermar/workspaces/[id]/rotate — new link, old one dies. VerMar operators. */
import { NextResponse } from 'next/server'
import { requireVerMarOperator, operatorErrorResponse } from '@/lib/hq-white-label/operatorGate'
import { operatorRotateWorkspaceLink } from '@/lib/hq-white-label/operator'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const gate = await requireVerMarOperator()
  if (gate instanceof NextResponse) return gate
  try {
    return NextResponse.json({ ok: true, url: await operatorRotateWorkspaceLink(params.id, gate.user) })
  } catch (e) {
    return operatorErrorResponse(e)
  }
}
