import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { ensureSignedAgreementForOrder } from '@/lib/orders/signedAgreement'
import { RECOVERABLE_AGREEMENT_STATES } from '@/lib/portal/agreementStatus'
import type { AgreementStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

// Admin-overridable target states. Imported from the canonical list in
// src/lib/portal/agreementStatus.ts so the API allow-list can't drift
// from the order-detail UI's manual-override button strip. SIGNED_*
// states are intentionally absent — they require a real signing event
// so the audit trail remains intact.
const OVERRIDE_TARGETS: readonly AgreementStatus[] = RECOVERABLE_AGREEMENT_STATES

/**
 * GET /api/orders/[id]/agreement
 *
 * Admin view of the SignedAgreement attached to this order. Auto-creates the
 * record on first read if one doesn't exist yet — keeps the order detail page
 * from rendering with no agreement section just because the order hasn't been
 * sent yet.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: { id: true, bookingId: true },
  })
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  await ensureSignedAgreementForOrder(order.id)

  const agreement = await prisma.signedAgreement.findUnique({
    where: { orderId_contractType: { orderId: order.id, contractType: 'RENTAL_AGREEMENT' } },
    select: {
      id: true,
      status: true,
      documentType: true,
      baselineVersion: true,
      contractReviewId: true,
      documentToSignUrl: true,
      redlineUploadUrl: true,
      signedDocumentUrl: true,
      wordDocumentUrl: true,
      signedAt: true,
      signerName: true,
      signerTitle: true,
      signerEmail: true,
      signerIpAddress: true,
      signerUserAgent: true,
      acknowledgmentText: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  let portalToken: string | null = null
  if (order.bookingId) {
    const paperwork = await prisma.paperworkRequest.findFirst({
      where: { bookingId: order.bookingId },
      orderBy: { sentAt: 'desc' },
      select: { token: true },
    })
    portalToken = paperwork?.token || null
  }

  return NextResponse.json({
    agreement,
    portalToken,
    portalUrl: portalToken ? `https://hq.sirreel.com/portal/${portalToken}` : null,
  })
}

/**
 * PATCH /api/orders/[id]/agreement
 *
 * Admin override of SignedAgreement.status. Reserved for recovery cases
 * (e.g., client uploaded the wrong redline, operator needs to bounce back to
 * DOWNLOAD_SENT). Cannot manually transition into a SIGNED_* state.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as { status?: unknown }
  const target = typeof body.status === 'string' ? body.status : ''
  if (!OVERRIDE_TARGETS.includes(target as AgreementStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${OVERRIDE_TARGETS.join(', ')}` },
      { status: 400 },
    )
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: { id: true },
  })
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  await ensureSignedAgreementForOrder(order.id)

  const updated = await prisma.signedAgreement.update({
    where: { orderId_contractType: { orderId: order.id, contractType: 'RENTAL_AGREEMENT' } },
    data: { status: target as AgreementStatus },
    select: { id: true, status: true },
  })

  return NextResponse.json({ ok: true, status: updated.status })
}
