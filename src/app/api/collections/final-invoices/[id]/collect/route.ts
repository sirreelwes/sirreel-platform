import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'

export const dynamic = 'force-dynamic'

/**
 * POST /api/collections/final-invoices/[id]/collect — record that a queued
 * final invoice was paid OUTSIDE HQ.
 *
 * Card charges stamp COLLECTED automatically in the charge route. Everything
 * else — wire, ACH push, Zelle, a check in the mail — arrives at the bank
 * with no HQ involvement, so without this action those invoices sit READY
 * forever and the queue slowly fills with already-paid rows nobody trusts.
 *
 * `via` is required: "collected" without "how" makes reconciliation a guess.
 * CARD is refused here — that path must carry a real gateway charge, and
 * accepting it manually would create COLLECTED-by-card rows with no retref.
 */
const VIAS = ['WIRE', 'ACH', 'ZELLE', 'CHECK', 'OTHER'] as const

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { via?: unknown }
  const via = typeof body.via === 'string' ? body.via.toUpperCase() : ''
  if (!(VIAS as readonly string[]).includes(via)) {
    return NextResponse.json(
      { ok: false, error: `via must be one of ${VIAS.join(', ')}` },
      { status: 400 },
    )
  }

  const fi = await prisma.jobFinalInvoice.findUnique({
    where: { id: params.id },
    select: { id: true, status: true },
  })
  if (!fi) return NextResponse.json({ ok: false, error: 'final invoice not found' }, { status: 404 })
  if (fi.status !== 'READY') {
    return NextResponse.json(
      { ok: false, error: `that invoice is already ${fi.status.toLowerCase()}` },
      { status: 409 },
    )
  }

  const updated = await prisma.jobFinalInvoice.update({
    where: { id: fi.id },
    data: {
      status: 'COLLECTED',
      collectedAt: new Date(),
      collectedVia: via,
      collectedById: user.id,
    },
    select: { id: true, status: true, collectedVia: true, collectedAt: true },
  })

  return NextResponse.json({ ok: true, finalInvoice: updated })
}
