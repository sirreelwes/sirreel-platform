import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getItemStock, type ItemStock } from '@/lib/inventory/stock'

export const dynamic = 'force-dynamic'

/**
 * Stock-on-hand vs. what is already spoken for, for the catalog rows on
 * an order — the number that renders beside each line's quantity and
 * goes red when the line asks for more than we can cover.
 *
 * POST rather than GET because the caller sends every catalog id on the
 * order and a builder can carry dozens; a query string would be at the
 * mercy of URL length. Staff-only: on-hand counts are internal.
 *
 * Body: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD',
 *         inventoryItemIds: string[], excludeOrderId?: string }
 * Returns: { stock: Record<inventoryItemId, ItemStock> }
 *
 * `excludeOrderId` leaves the order being edited out of the committed
 * total — its own lines must not count against it. Callers net their
 * own sibling lines client-side (see StockChip), which is what lets the
 * number react as an agent types a quantity.
 */

/** Date-only columns are UTC midnight — parse the same way or a window
 *  silently shifts a day for anyone west of Greenwich. */
function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const start = parseDateOnly(body?.start)
  const end = parseDateOnly(body?.end)
  if (!start || !end) {
    return NextResponse.json({ error: 'start and end (YYYY-MM-DD) are required' }, { status: 400 })
  }
  if (end < start) {
    return NextResponse.json({ error: 'end must not precede start' }, { status: 400 })
  }

  const rawIds = Array.isArray(body?.inventoryItemIds) ? body.inventoryItemIds : []
  const inventoryItemIds = rawIds.filter((id: unknown): id is string => typeof id === 'string' && !!id)
  if (inventoryItemIds.length === 0) {
    return NextResponse.json({ stock: {} })
  }

  const excludeOrderId = typeof body?.excludeOrderId === 'string' ? body.excludeOrderId : null

  const stock = await getItemStock(inventoryItemIds, { start, end }, { excludeOrderId })

  const out: Record<string, ItemStock> = {}
  for (const [id, row] of stock) out[id] = row
  return NextResponse.json({ stock: out })
}
