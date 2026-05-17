import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET    /api/orders/[id]/cadence — read cadence state for the order.
 * PATCH  /api/orders/[id]/cadence — rep manual override controls. Body:
 *   { manualOverride?: boolean, cadencePausedUntil?: string|null }
 *
 * Sales tool: lets a rep stop auto-cadence on a quote without changing the
 * quoteStatus. The runner's safety gate (src/lib/cadence/runner.ts) honors
 * cadenceManualOverride and cadencePausedUntil — flipping either here is
 * enough to stop the next email from firing.
 */

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      cadenceState: true,
      cadenceManualOverride: true,
      cadencePausedUntil: true,
    },
  })
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const events = await prisma.cadenceEvent.findMany({
    where: { orderId: order.id },
    orderBy: { scheduledFor: 'asc' },
    select: {
      id: true,
      eventType: true,
      scheduledFor: true,
      executedAt: true,
      skipped: true,
      skipReason: true,
    },
  })

  return NextResponse.json({ order, events })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    manualOverride?: unknown
    cadencePausedUntil?: unknown
  }

  const data: Record<string, unknown> = {}
  if (typeof body.manualOverride === 'boolean') {
    data.cadenceManualOverride = body.manualOverride
  }
  if (body.cadencePausedUntil === null) {
    data.cadencePausedUntil = null
  } else if (typeof body.cadencePausedUntil === 'string') {
    const parsed = new Date(body.cadencePausedUntil)
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'Invalid cadencePausedUntil' }, { status: 400 })
    }
    data.cadencePausedUntil = parsed
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const updated = await prisma.order
    .update({
      where: { id: params.id },
      data,
      select: {
        id: true,
        cadenceState: true,
        cadenceManualOverride: true,
        cadencePausedUntil: true,
      },
    })
    .catch(() => null)
  if (!updated) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, order: updated })
}
