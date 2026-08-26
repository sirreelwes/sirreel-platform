import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/orders/[id]/archive        → soft-archive (sets archivedAt = now)
 * POST /api/orders/[id]/archive?undo=1 → unarchive (clears archivedAt)
 *
 * Visibility-only, mirroring the Job archive endpoint. The order detail page
 * stays reachable; /orders hides archived rows by default and `archived=1`
 * lists them. Idempotent — re-archiving an archived order is a no-op that
 * preserves the original stamp, so the audit trail doesn't drift on a
 * double-click.
 *
 * This is deliberately NOT a status. An abandoned parse or a duplicate is not
 * "cancelled" — writing CANCELLED on it would put a business fact in the
 * record that never happened. Archive says only "stop showing me this."
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id || null
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const undo = req.nextUrl.searchParams.get('undo') === '1'

  const existing = await prisma.order.findUnique({
    where: { id },
    select: { id: true, archivedAt: true },
  })
  if (!existing) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Idempotent both directions — keep the first archive's stamp/actor.
  if (!undo && existing.archivedAt) {
    return NextResponse.json({ ok: true, archivedAt: existing.archivedAt })
  }

  const order = await prisma.order.update({
    where: { id },
    data: undo
      ? { archivedAt: null, archivedById: null }
      : { archivedAt: new Date(), archivedById: userId },
    select: { id: true, archivedAt: true },
  })
  return NextResponse.json({ ok: true, archivedAt: order.archivedAt })
}
