import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * POST /api/orders/[id]/contract-review/accept
 *
 * Internal (sales/admin only). Operator marks the ContractReview attached
 * to this order as the final accepted version: generates the negotiated
 * PDF, sets SignedAgreement.documentToSignUrl, documentType=NEGOTIATED,
 * status=NEGOTIATED_READY, then emails the client. Stub: validates the
 * session + order and returns 501.
 *
 * Routed under `[id]` to match the existing /api/orders/[id]/... convention;
 * the feature brief uses `[orderId]` interchangeably for the same param.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: { id: true },
  })
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  return NextResponse.json(
    { error: 'Not implemented', stub: true, orderId: order.id },
    { status: 501 },
  )
}
