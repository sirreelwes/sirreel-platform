/**
 * POST /api/orders/[id]/date-change-request — close the client's open
 * date-change ask by hand.
 *
 * Applying the dates through "Change dates…" closes it on its own
 * (/dates/apply calls resolveDateChangeRequests). This is the other
 * answer: the rep spoke to the client, or the change is not happening, or
 * it was handled some other way. Either way the queue should stop asking.
 *
 * Closing NOTHING else: the order is untouched, and no mail goes to the
 * client — telling them their request is closed is a conversation, not a
 * status change, and it belongs on the job thread where the rest of it is.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveOneDateChangeRequest } from '@/lib/portal/dateChangeRequest'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const REASONS = new Set(['HANDLED', 'DECLINED', 'SPOKE_TO_CLIENT'])

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const requestId = typeof body.requestId === 'string' ? body.requestId : null
  if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 })
  const reason =
    typeof body.reason === 'string' && REASONS.has(body.reason) ? body.reason : 'HANDLED'

  // Scoped to THIS order, so a guessed id cannot close another
  // production's request.
  const closed = await resolveOneDateChangeRequest({
    id: requestId,
    orderId: id,
    reason,
    byUserId: user.id,
  })
  if (!closed) {
    return NextResponse.json(
      { error: 'That request is already closed, or is not on this order.' },
      { status: 409 },
    )
  }

  await prisma.auditLog
    .create({
      data: {
        action: 'order.date_change_request_closed',
        entityType: 'Order',
        entityId: id,
        userId: user.id,
        newValues: { requestId, reason },
      },
    })
    .catch((e) => console.error('[date-change-request/close] audit failed:', e))

  return NextResponse.json({ ok: true })
}
