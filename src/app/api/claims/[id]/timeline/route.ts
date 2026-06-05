/**
 * POST /api/claims/[id]/timeline — append a ClaimTimeline row.
 *
 * For free-text notes / counter-sent records / etc. that the PATCH
 * endpoint's auto-events don't cover. The rep picks the action
 * (NEGOTIATION_NOTE by default) + writes a description, optionally
 * with an amount.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import type { ClaimAction } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const ACTIONS: ClaimAction[] = [
  'CREATED', 'SUBMITTED', 'ADJUSTER_ASSIGNED', 'OFFER_RECEIVED',
  'COUNTER_SENT', 'NEGOTIATION_NOTE', 'SETTLED', 'DENIED',
  'ESCALATED', 'DOCUMENT_ADDED',
]

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const me = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown
    description?: unknown
    amount?: unknown
  }

  const actionRaw = typeof body.action === 'string' ? body.action : 'NEGOTIATION_NOTE'
  const action = (ACTIONS as string[]).includes(actionRaw)
    ? (actionRaw as ClaimAction)
    : null
  if (!action) {
    return NextResponse.json({ error: `action must be one of: ${ACTIONS.join(', ')}` }, { status: 400 })
  }

  const description =
    typeof body.description === 'string' && body.description.trim().length > 0
      ? body.description.trim().slice(0, 10_000)
      : null
  if (!description) {
    return NextResponse.json({ error: 'description required' }, { status: 400 })
  }

  let amount: number | null = null
  if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
    const n = typeof body.amount === 'number' ? body.amount : Number(body.amount)
    if (!Number.isFinite(n)) {
      return NextResponse.json({ error: 'amount must be a number' }, { status: 400 })
    }
    amount = n
  }

  const claim = await prisma.insuranceClaim.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!claim) return NextResponse.json({ error: 'claim not found' }, { status: 404 })

  const row = await prisma.claimTimeline.create({
    data: {
      claimId: id,
      action,
      description,
      amount: amount ?? null,
      performedBy: me.id,
    },
    select: { id: true, action: true, createdAt: true },
  })
  return NextResponse.json({ ok: true, timelineEntry: row }, { status: 201 })
}
