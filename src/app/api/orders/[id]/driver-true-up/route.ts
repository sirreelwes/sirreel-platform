/**
 * /api/orders/[id]/driver-true-up — the driver line against the hours the
 * driver actually logged.
 *
 *   GET  → one entry per driver line: the logged days priced by the ladder,
 *          the quoted amount, and the difference. Read-only.
 *   POST { lineId } → put the actual amount on that line, recalc the order,
 *          audit it. One line per call, so an operator never applies more
 *          than they looked at.
 *
 * Wes 2026-09-07: "now wire the actual hours to the invoice." The invoice
 * generator reads live order lines, so applying here is what reaches the
 * invoice — and it stays a click.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { applyDriverTrueUp, driverTrueUpForOrder } from '@/lib/orders/driverTrueUp'
import { isLineItemEditable, lineEditLockReason } from '@/lib/orders/editability'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

async function staff() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return null
  return prisma.user.findUnique({ where: { email }, select: { id: true } })
}

export async function GET(_req: NextRequest, { params }: Params) {
  if (!(await staff())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ ok: true, lines: await driverTrueUpForOrder(params.id) })
}

export async function POST(req: NextRequest, { params }: Params) {
  const me = await staff()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { lineId?: unknown } | null
  const lineId = typeof body?.lineId === 'string' ? body.lineId : ''
  if (!lineId) return NextResponse.json({ ok: false, error: 'lineId required' }, { status: 400 })

  const line = await prisma.orderLineItem.findFirst({
    where: { id: lineId, orderId: params.id },
    select: { department: true, order: { select: { status: true } } },
  })
  if (!line) return NextResponse.json({ ok: false, error: 'Line not found on this order.' }, { status: 404 })
  // An invoiced or closed order's lines are committed to a paper trail.
  if (!isLineItemEditable(line.order.status, line.department)) {
    return NextResponse.json(
      { ok: false, error: lineEditLockReason(line.order.status, line.department) ?? 'This order can no longer be edited.' },
      { status: 409 },
    )
  }

  const r = await applyDriverTrueUp({ orderId: params.id, lineId, userId: me.id })
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status })
  return NextResponse.json(r)
}
