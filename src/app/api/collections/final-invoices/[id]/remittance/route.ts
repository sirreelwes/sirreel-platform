import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'

export const dynamic = 'force-dynamic'

/**
 * POST /api/collections/final-invoices/[id]/remittance — record that the
 * client has sent proof they paid. DELETE clears it.
 *
 * Ana, 2026-09-04: "If a client is choosing to pay by ACH, it would be good
 * to have a spot where we can confirm whether or not they sent us proof of
 * remittance."
 *
 * The gap this fills: an ACH takes days to land. In that window the queue row
 * looked exactly like a client who has said nothing — so the invoice got
 * chased again (to a client who has already paid), or got marked collected
 * early against money that had not arrived. Neither is recoverable from the
 * row afterwards.
 *
 * This is the CLAIM, not the arrival. Mark collected still means the money is
 * in — this route deliberately does not touch `status`, and a remittance on
 * file is not evidence the payment cleared. It DOES prefill Mark collected's
 * method, so the two stay consistent when it does.
 *
 * Reversible on purpose: a client's "we sent it Tuesday" is sometimes wrong,
 * and a flag that cannot be taken back would leave the queue quietly lying.
 */

const VIAS = ['WIRE', 'ACH', 'ZELLE', 'CHECK', 'OTHER'] as const

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as {
    via?: unknown
    ref?: unknown
    note?: unknown
  }
  const via = typeof body.via === 'string' ? body.via.toUpperCase() : ''
  if (!(VIAS as readonly string[]).includes(via)) {
    return NextResponse.json(
      { ok: false, error: `via must be one of ${VIAS.join(', ')}` },
      { status: 400 },
    )
  }
  const ref = typeof body.ref === 'string' ? body.ref.trim().slice(0, 120) : ''
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : ''

  const fi = await prisma.jobFinalInvoice.findUnique({
    where: { id: params.id },
    select: { id: true, status: true },
  })
  if (!fi) return NextResponse.json({ ok: false, error: 'final invoice not found' }, { status: 404 })
  // Logging a remittance against an invoice already settled says nothing
  // useful and muddies the collected record.
  if (fi.status !== 'READY') {
    return NextResponse.json(
      { ok: false, error: `that invoice is already ${fi.status.toLowerCase()}` },
      { status: 409 },
    )
  }

  const updated = await prisma.jobFinalInvoice.update({
    where: { id: fi.id },
    data: {
      remittanceAt: new Date(),
      remittanceVia: via,
      remittanceRef: ref || null,
      remittanceNote: note || null,
      remittanceById: user.id,
    },
    select: {
      id: true,
      remittanceAt: true,
      remittanceVia: true,
      remittanceRef: true,
      remittanceNote: true,
    },
  })

  return NextResponse.json({ ok: true, finalInvoice: updated })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const fi = await prisma.jobFinalInvoice.findUnique({
    where: { id: params.id },
    select: { id: true },
  })
  if (!fi) return NextResponse.json({ ok: false, error: 'final invoice not found' }, { status: 404 })

  await prisma.jobFinalInvoice.update({
    where: { id: fi.id },
    data: {
      remittanceAt: null,
      remittanceVia: null,
      remittanceRef: null,
      remittanceNote: null,
      remittanceById: null,
    },
  })

  return NextResponse.json({ ok: true })
}
