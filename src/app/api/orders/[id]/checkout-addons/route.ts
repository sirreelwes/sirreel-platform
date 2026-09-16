/**
 * /api/orders/[id]/checkout-addons — last-minute add-ons at check-out.
 *
 *   GET  — the one-tap chips and what was already added on this order
 *          (any staff session)
 *   POST { items: [{ inventoryItemId?, description, quantity }], driverName,
 *          addedBy, note? } — put them on the order (lib/orders/checkoutAddOns)
 *
 * Yard work, same gate as filing a check-out sheet (requireYardAccess:
 * fleet or warehouse). Prices come from the server — the browser never
 * sends a rate.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { requireYardAccess } from '@/lib/yard/requireYardAccess'
import {
  addCheckoutAddOns,
  checkoutAddedLines,
  CheckoutAddOnError,
  quickAddOns,
} from '@/lib/orders/checkoutAddOns'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Reading an order's lines is any staff member's business (the order
  // page shows "Added at check-out"); adding them is yard work.
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const { id } = await params
  const [quick, added] = await Promise.all([quickAddOns(), checkoutAddedLines(id)])
  return NextResponse.json({ ok: true, quick, added })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireYardAccess()
  if (!auth.ok) return auth.response
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as {
    items?: unknown
    driverName?: unknown
    addedBy?: unknown
    note?: unknown
  }
  const items = Array.isArray(body.items)
    ? (body.items as any[]).slice(0, 30).map((i) => ({
        inventoryItemId: typeof i?.inventoryItemId === 'string' ? i.inventoryItemId : null,
        description: typeof i?.description === 'string' ? i.description : '',
        quantity: Number(i?.quantity) || 1,
      }))
    : []
  try {
    const result = await addCheckoutAddOns({
      orderId: id,
      items,
      driverName: typeof body.driverName === 'string' ? body.driverName : null,
      addedBy: typeof body.addedBy === 'string' ? body.addedBy : auth.name || '',
      note: typeof body.note === 'string' ? body.note.slice(0, 500) : null,
      userId: auth.userId,
    })
    return NextResponse.json({ ok: true, ...result, lines: await checkoutAddedLines(id) })
  } catch (err) {
    if (err instanceof CheckoutAddOnError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status })
    }
    console.error('[checkout-addons] failed:', err)
    return NextResponse.json({ ok: false, error: 'Could not add those — try again.' }, { status: 500 })
  }
}
