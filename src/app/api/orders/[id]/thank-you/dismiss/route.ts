/**
 * POST /api/orders/[id]/thank-you/dismiss
 *
 * Marks the suggestion DISMISSED with a free-text reason — the
 * "why we didn't thank this client" audit when reviewing the queue.
 *
 * Body: { reason?: string }
 * Auth: getServerSession.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { ThankYouStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { reason?: string }

  const suggestion = await prisma.thankYouSuggestion.findUnique({
    where: { orderId: id },
    select: { id: true, status: true },
  })
  if (!suggestion) return NextResponse.json({ error: 'no suggestion for this order' }, { status: 404 })
  if (suggestion.status === ThankYouStatus.SENT) {
    return NextResponse.json({ error: 'thank-you already sent — cannot dismiss' }, { status: 409 })
  }

  await prisma.thankYouSuggestion.update({
    where: { id: suggestion.id },
    data: {
      status: ThankYouStatus.DISMISSED,
      dismissedAt: new Date(),
      dismissedReason: body.reason?.trim() || null,
    },
  })
  return NextResponse.json({ ok: true })
}
