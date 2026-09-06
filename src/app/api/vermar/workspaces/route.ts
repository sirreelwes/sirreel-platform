/** GET /api/vermar/workspaces — every partner workspace, plus partners who
 *  could have one. VerMar operators only. */
import { NextResponse } from 'next/server'
import { requireVerMarOperator } from '@/lib/hq-white-label/operatorGate'
import { listWorkspacesForOperator } from '@/lib/hq-white-label/operator'
import { listLeads } from '@/lib/hq-white-label/leads'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireVerMarOperator()
  if (gate instanceof NextResponse) return gate
  const [list, leads] = await Promise.all([listWorkspacesForOperator(), listLeads()])
  return NextResponse.json({ ...list, leads, operator: gate.user.email })
}
