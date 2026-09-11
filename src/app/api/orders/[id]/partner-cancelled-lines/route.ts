/**
 * /api/orders/[id]/partner-cancelled-lines — lines whose partner booking was
 * cancelled and that never went on the pick list (partnerCancelledLines.ts).
 *
 *   GET  → the waiting lines on this order. Read-only.
 *   POST { lineId } → put that line on the pick list, audited. One line per
 *          call, so nobody files more than they looked at.
 *
 * Wes 2026-09-11: partner lines stay off the pick list, and "there needs to be
 * a warning wired in" for the line a partner cancels and SirReel then fills.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { findPartnerCancelledLines, putPartnerCancelledLineOnPickList } from '@/lib/orders/partnerCancelledLines'

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
  const lines = await findPartnerCancelledLines(prisma, { orderId: params.id })
  return NextResponse.json({ ok: true, lines })
}

export async function POST(req: NextRequest, { params }: Params) {
  const me = await staff()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { lineId?: unknown } | null
  const lineId = typeof body?.lineId === 'string' ? body.lineId : ''
  if (!lineId) return NextResponse.json({ ok: false, error: 'lineId required' }, { status: 400 })

  const onOrder = await prisma.orderLineItem.findFirst({ where: { id: lineId, orderId: params.id }, select: { id: true } })
  if (!onOrder) return NextResponse.json({ ok: false, error: 'Line not found on this order.' }, { status: 404 })

  const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
  const r = await prisma.$transaction((tx) => putPartnerCancelledLineOnPickList(tx, lineId, { userId: me.id, ipAddress }))
  if (!r.ok) return NextResponse.json({ ok: false, error: r.reason }, { status: 409 })
  return NextResponse.json(r)
}
