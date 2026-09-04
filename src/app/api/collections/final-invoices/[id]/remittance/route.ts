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
 *
 * THE FILE. `proofUrl`/`proofKey` come from POST /api/collections/upload with
 * kind=remittance (PDF or image — an advice arrives as whatever their AP
 * department could export). Wes, 2026-09-04, after Ana's first note: attach
 * the proof itself. "They said they sent it" and a remittance advice on file
 * are different facts, and only one of them survives a dispute.
 *
 * A POST REPLACES the whole record, file included — so a re-log that means to
 * keep the existing attachment has to send it back. That is deliberate: the
 * alternative (absent means keep) leaves no way to remove a file attached to
 * the wrong invoice.
 */

const VIAS = ['WIRE', 'ACH', 'ZELLE', 'CHECK', 'OTHER'] as const

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as {
    via?: unknown
    ref?: unknown
    note?: unknown
    proofUrl?: unknown
    proofKey?: unknown
    proofName?: unknown
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
  const proofUrl = typeof body.proofUrl === 'string' ? body.proofUrl.trim() : ''
  const proofKey = typeof body.proofKey === 'string' ? body.proofKey.trim() : ''
  const proofName = typeof body.proofName === 'string' ? body.proofName.trim().slice(0, 200) : ''
  // A url with no key can't be re-fetched or cleaned up later; a key with no
  // url can't be opened. Half an attachment is worse than none.
  if (!!proofUrl !== !!proofKey) {
    return NextResponse.json(
      { ok: false, error: 'proofUrl and proofKey must be sent together' },
      { status: 400 },
    )
  }
  // Only our own blob store. A url from anywhere else would turn this field
  // into an open redirect that staff are told to click.
  // The store is `.private.` here (put runs with access:'private'); `.public.`
  // is allowed too so an older key or a store move doesn't lock a file out.
  if (
    proofUrl &&
    !/^https:\/\/[a-z0-9-]+\.(private|public)\.blob\.vercel-storage\.com\//i.test(proofUrl)
  ) {
    return NextResponse.json(
      { ok: false, error: 'that file did not come from the collections uploader' },
      { status: 400 },
    )
  }

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
      remittanceProofUrl: proofUrl || null,
      remittanceProofKey: proofKey || null,
      remittanceProofName: proofName || null,
    },
    select: {
      id: true,
      remittanceAt: true,
      remittanceVia: true,
      remittanceRef: true,
      remittanceNote: true,
      remittanceProofUrl: true,
      remittanceProofName: true,
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
      // The blob itself is left in place. Deleting it here would destroy the
      // client's document on a mis-click, and these are small.
      remittanceProofUrl: null,
      remittanceProofKey: null,
      remittanceProofName: null,
    },
  })

  return NextResponse.json({ ok: true })
}
