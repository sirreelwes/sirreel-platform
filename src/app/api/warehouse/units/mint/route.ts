import { NextRequest, NextResponse } from 'next/server'
import { requireLabelAccess } from '@/lib/warehouse/labelAccess'
import { mintUnits } from '@/lib/warehouse/mintUnits'
import { MAX_MINT_PER_BATCH } from '@/lib/warehouse/unitLabels'

export const dynamic = 'force-dynamic'

/**
 * POST /api/warehouse/units/mint — give N pieces of a catalog item their
 * own SR numbers (HQ's SR900000+ block), so a label can be printed for
 * each and the check-out desk can scan them.
 *
 *   { inventoryItemId, count, serialNumbers?: string[] }
 *
 * Yard staff or sales (requireLabelAccess). Audited `inventory.units_minted`.
 * The register rows exist from this moment whether or not the sheet is
 * printed — print it from the response, or later by barcode.
 */
export async function POST(req: NextRequest) {
  const auth = await requireLabelAccess()
  if (!auth.ok) return auth.response

  let body: { inventoryItemId?: unknown; count?: unknown; serialNumbers?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const inventoryItemId = typeof body.inventoryItemId === 'string' ? body.inventoryItemId.trim() : ''
  if (!inventoryItemId) return NextResponse.json({ error: 'inventoryItemId is required' }, { status: 400 })

  const serialNumbers = Array.isArray(body.serialNumbers)
    ? body.serialNumbers.map((s) => (typeof s === 'string' ? s : null))
    : undefined
  const count = serialNumbers?.length
    ? serialNumbers.length
    : typeof body.count === 'number' ? body.count : Number(body.count)
  if (!Number.isFinite(count) || count < 1 || count > MAX_MINT_PER_BATCH) {
    return NextResponse.json({ error: `count must be between 1 and ${MAX_MINT_PER_BATCH}` }, { status: 400 })
  }

  const r = await mintUnits({ inventoryItemId, count, serialNumbers, userId: auth.userId })
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.status })
  return NextResponse.json({ item: r.item, units: r.units })
}
