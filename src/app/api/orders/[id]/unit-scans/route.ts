import { NextRequest, NextResponse } from 'next/server'
import { requireYardAccess } from '@/lib/yard/requireYardAccess'
import { recordUnitScan, unitScanSummary } from '@/lib/warehouse/unitScans'

export const dynamic = 'force-dynamic'

/**
 * /api/orders/[id]/unit-scans — a barcoded unit, scanned at the desk
 * (barcode phase 3).
 *
 *   GET   → the order's scans grouped by line (null `summary` until the
 *           table exists — the form hides the panel)
 *   POST  → { edge: 'OUT'|'IN', code, allowOver?, closeOpen? }
 *           Records the unit against the order. Every refusal is a 409
 *           with a `reason` the supervisor can act on and an `override`
 *           naming the flag that would push it through:
 *             allowOver — beyond the line's quantity, or not on the order
 *             closeOpen — the unit is still open on another order; mark it
 *                         back from there and carry on
 *
 * Gated like the check report itself: yard staff (fleet or warehouse).
 * The wedge scanners type into the same screen the supervisor is already
 * on, so this is the same person and the same door.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireYardAccess()
  if (!auth.ok) return auth.response
  const { id } = await params
  const summary = await unitScanSummary(id)
  return NextResponse.json({ summary })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireYardAccess()
  if (!auth.ok) return auth.response
  const { id } = await params

  const body = (await req.json().catch(() => ({}))) as {
    edge?: unknown
    code?: unknown
    allowOver?: unknown
    closeOpen?: unknown
  }
  const edge = body.edge === 'OUT' || body.edge === 'IN' ? body.edge : null
  if (!edge) return NextResponse.json({ error: 'edge must be OUT or IN' }, { status: 400 })
  const raw = typeof body.code === 'string' ? body.code : ''
  if (!raw.trim()) return NextResponse.json({ error: 'code is required' }, { status: 400 })

  const result = await recordUnitScan({
    orderId: id,
    edge,
    raw,
    userId: auth.userId,
    allowOver: body.allowOver === true,
    closeOpen: body.closeOpen === true,
  })
  if (!result.ok) {
    return NextResponse.json(
      { error: result.code, reason: result.reason, override: result.override, openOn: result.openOn ?? null },
      { status: result.status },
    )
  }
  return NextResponse.json(result)
}
