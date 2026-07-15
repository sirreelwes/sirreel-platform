import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import type { Prisma, ReviewDecision } from '@prisma/client'

export const dynamic = 'force-dynamic'

const VALID_DECISIONS: ReviewDecision[] = ['PENDING', 'APPROVED', 'COUNTERED', 'REJECTED']

async function requireSessionUser() {
  const session = await getServerSession()
  if (!session?.user?.email) return null
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  return user
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const sessionUser = await requireSessionUser()
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const record = await prisma.contractReview.findFirst({
    where: { id: params.id, deletedAt: null },
    include: {
      company: { select: { id: true, name: true } },
      job: { select: { id: true, jobCode: true, name: true } },
      uploadedBy: { select: { id: true, name: true, email: true } },
      humanDecisionBy: { select: { id: true, name: true, email: true } },
      counterGeneratedBy: { select: { id: true, name: true, email: true } },
      // Per-clause Discuss threads — persisted for audit, grouped by
      // clauseKey client-side.
      clauseMessages: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          clauseKey: true,
          role: true,
          content: true,
          createdAt: true,
          createdBy: { select: { id: true, name: true } },
        },
      },
      changeDecisions: {
        orderBy: { changeIndex: 'asc' },
        include: {
          decidedBy: { select: { id: true, name: true, email: true } },
        },
      },
      signedAgreement: {
        select: {
          id: true,
          status: true,
          documentType: true,
          orderId: true,
          order: {
            select: { id: true, orderNumber: true, company: { select: { name: true } } },
          },
        },
      },
    },
  })

  if (!record) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ review: record })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const sessionUser = await requireSessionUser()
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const existing = await prisma.contractReview.findFirst({
    where: { id: params.id, deletedAt: null },
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const data: Prisma.ContractReviewUpdateInput = {}

  // jobId / companyId — set only, never clear (per Phase 3 spec)
  if (typeof body.jobId === 'string' && body.jobId.length > 0) {
    data.job = { connect: { id: body.jobId } }
  }
  if (typeof body.companyId === 'string' && body.companyId.length > 0) {
    data.company = { connect: { id: body.companyId } }
  }

  if (
    typeof body.humanDecision === 'string' &&
    (VALID_DECISIONS as readonly string[]).includes(body.humanDecision)
  ) {
    data.humanDecision = body.humanDecision as ReviewDecision
    data.humanDecisionBy = { connect: { id: sessionUser.id } }
    data.humanDecisionAt = new Date()
  }

  if (typeof body.humanDecisionNote === 'string') {
    data.humanDecisionNote = body.humanDecisionNote
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 })
  }

  try {
    const updated = await prisma.contractReview.update({
      where: { id: params.id },
      data,
      include: {
        company: { select: { id: true, name: true } },
        job: { select: { id: true, jobCode: true, name: true } },
        uploadedBy: { select: { id: true, name: true, email: true } },
        humanDecisionBy: { select: { id: true, name: true, email: true } },
        counterGeneratedBy: { select: { id: true, name: true, email: true } },
        changeDecisions: {
          orderBy: { changeIndex: 'asc' },
          include: {
            decidedBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
    })
    return NextResponse.json({ review: updated })
  } catch (err) {
    console.error('PATCH /api/tools/contract-review/[id] error:', err)
    return NextResponse.json({ error: 'Failed to update review' }, { status: 500 })
  }
}
