/**
 * GET /api/orders/[id]/walkie-supply — does HQ have the radios for this
 * order, or does it need to sub some in?
 *
 * Wes, 2026-09-15: "we should have HQ manage whether or not we need to
 * sublease the walkies from another company." The decision lives in
 * lib/catalog/walkies.ts (pure) over the book loaded by walkiePool.ts;
 * this is the order page's window onto it.
 *
 * Staff-only and money-free apart from the line's own rate, which the
 * sub-rental modal already shows the rep. `{ hasWalkies: false }` for an
 * order with no walkie lines, so the page renders nothing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { loadWalkieBook, walkieSupplyForOrder } from '@/lib/catalog/walkiePool'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const book = await loadWalkieBook()
  const supply = walkieSupplyForOrder(book, id)
  if (!supply) return NextResponse.json({ hasWalkies: false })

  return NextResponse.json({ hasWalkies: true, ...supply })
}
