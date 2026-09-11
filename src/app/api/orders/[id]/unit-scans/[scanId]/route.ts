import { NextRequest, NextResponse } from 'next/server'
import { requireYardAccess } from '@/lib/yard/requireYardAccess'
import { voidUnitScan } from '@/lib/warehouse/unitScans'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/orders/[id]/unit-scans/[scanId] — undo a scan.
 *
 * Body (optional): { reason }
 *
 * The row is VOIDED, not deleted: the audit trail keeps the wrong scan
 * and who withdrew it. Same yard door as recording one.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; scanId: string }> }) {
  const auth = await requireYardAccess()
  if (!auth.ok) return auth.response
  const { id, scanId } = await params
  const body = (await req.json().catch(() => ({}))) as { reason?: unknown }
  const result = await voidUnitScan({
    orderId: id,
    scanId,
    userId: auth.userId,
    reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null,
  })
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.status })
  return NextResponse.json(result)
}
