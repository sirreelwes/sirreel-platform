/**
 * Attach a job-linked contract review to one of the job's order agreements,
 * so it can be accepted as final.
 *
 *   GET  — the job's orders whose rental agreement could take it
 *   POST { orderId } — link it (SignedAgreement.contractReviewId, status
 *          UNDER_REVIEW); the desk then calls the existing
 *          /api/orders/[id]/contract-review/accept.
 *
 * Why (2026-09-15): a redline uploaded at /tools/contract-review carries a
 * jobId but no agreement, so "Accept as Final" never appeared for it — and
 * once the portal stopped offering the standard agreement for signature
 * while a counter-proposal is open (Wes: "sign button should go away"), a
 * review like SR-JOB-0347's had no way to reach a signature at all.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const SIGNED = new Set(['SIGNED_BASELINE', 'SIGNED_NEGOTIATED', 'SIGNED_OFFLINE'])

async function load(reviewId: string) {
  const review = await prisma.contractReview.findFirst({
    where: { id: reviewId, deletedAt: null },
    select: { id: true, jobId: true, counterPdfKey: true, signedAgreement: { select: { id: true } } },
  })
  if (!review?.jobId) return { review, candidates: [] as Array<{ orderId: string; orderNumber: string; status: string; agreementStatus: string }> }
  const orders = await prisma.order.findMany({
    where: { jobId: review.jobId, status: { not: 'CANCELLED' } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      signedAgreements: {
        where: { contractType: 'RENTAL_AGREEMENT' },
        select: { status: true, contractReviewId: true },
      },
    },
  })
  const candidates = orders.flatMap((o) => {
    const a = o.signedAgreements[0]
    if (!a || a.contractReviewId || SIGNED.has(a.status)) return []
    return [{ orderId: o.id, orderNumber: o.orderNumber, status: o.status, agreementStatus: a.status }]
  })
  return { review, candidates }
}

async function staff() {
  const session = await getServerSession()
  if (!session?.user?.email) return false
  return !!(await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } }))
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await staff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { review, candidates } = await load(params.id)
  if (!review) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, candidates })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await staff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { orderId?: unknown }
  const { review, candidates } = await load(params.id)
  if (!review) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (review.signedAgreement) return NextResponse.json({ error: 'This review is already linked to an agreement.' }, { status: 409 })
  const pick = candidates.find((c) => c.orderId === body.orderId)
  if (!pick) {
    return NextResponse.json({ error: "That order's agreement can't take this review (other job, signed, or already linked)." }, { status: 409 })
  }
  await prisma.signedAgreement.update({
    where: { orderId_contractType: { orderId: pick.orderId, contractType: 'RENTAL_AGREEMENT' } },
    data: { contractReviewId: review.id, status: 'UNDER_REVIEW' },
  })
  return NextResponse.json({ ok: true, orderId: pick.orderId, orderNumber: pick.orderNumber })
}
