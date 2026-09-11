import { NextRequest, NextResponse } from 'next/server'
import { requireYardAccess } from '@/lib/yard/requireYardAccess'
import { setUnitScanMissing } from '@/lib/warehouse/unitScans'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/orders/[id]/unit-scans/[scanId]/checks — mark a per-unit
 * check missing (or present again) on one scanned unit.
 *
 * Body: { edge: 'OUT'|'IN', missing: string[] }
 *
 * `missing` is the whole list for that edge — the chips on the desk are
 * the state, and each tap sends the new list. Names outside the item's
 * `unitChecks` are dropped. Same yard door as the scan itself.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; scanId: string }> }) {
  const auth = await requireYardAccess()
  if (!auth.ok) return auth.response
  const { id, scanId } = await params
  const body = (await req.json().catch(() => ({}))) as { edge?: unknown; missing?: unknown }
  const edge = body.edge === 'OUT' || body.edge === 'IN' ? body.edge : null
  if (!edge) return NextResponse.json({ error: 'edge must be OUT or IN' }, { status: 400 })
  const result = await setUnitScanMissing({ orderId: id, scanId, edge, missing: body.missing, userId: auth.userId })
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.status })
  return NextResponse.json(result)
}
