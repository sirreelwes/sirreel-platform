import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import type { Prisma, ReviewDecision } from '@prisma/client'

export const dynamic = 'force-dynamic'

const VALID_DECISIONS: ReviewDecision[] = ['PENDING', 'APPROVED', 'COUNTERED', 'REJECTED']
const VALID_RISK_LEVELS = ['low', 'medium', 'high'] as const
const VALID_RECOMMENDATIONS = ['approve', 'counter', 'reject'] as const

export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp = req.nextUrl.searchParams
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '10', 10) || 10))
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
  const skip = (page - 1) * limit

  const jobId = sp.get('jobId')
  const companyId = sp.get('companyId')
  const orphansOnly = sp.get('orphansOnly') === 'true'
  const riskLevel = sp.get('riskLevel')
  const recommendation = sp.get('recommendation')
  const humanDecision = sp.get('humanDecision')
  const agentId = sp.get('agentId')
  const mineOnly = sp.get('mineOnly') === 'true'
  const from = sp.get('from')
  const to = sp.get('to')

  const where: Prisma.ContractReviewWhereInput = { deletedAt: null }
  if (jobId) where.jobId = jobId
  if (companyId) where.companyId = companyId
  if (orphansOnly) where.jobId = null
  if (riskLevel && (VALID_RISK_LEVELS as readonly string[]).includes(riskLevel)) {
    where.aiRiskLevel = riskLevel
  }
  if (recommendation && (VALID_RECOMMENDATIONS as readonly string[]).includes(recommendation)) {
    where.aiRecommendation = recommendation
  }
  if (humanDecision && (VALID_DECISIONS as readonly string[]).includes(humanDecision)) {
    where.humanDecision = humanDecision as ReviewDecision
  }
  if (mineOnly) {
    where.uploadedById = sessionUser.id
  } else if (agentId) {
    where.uploadedById = agentId
  }
  if (from || to) {
    where.createdAt = {}
    if (from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(from)
    if (to) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(to)
  }

  try {
    const [items, total, orphanCount] = await Promise.all([
      prisma.contractReview.findMany({
        where,
        include: {
          company: { select: { id: true, name: true } },
          job: { select: { id: true, jobCode: true, name: true } },
          uploadedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.contractReview.count({ where }),
      prisma.contractReview.count({ where: { deletedAt: null, jobId: null } }),
    ])

    return NextResponse.json({ items, total, page, limit, orphanCount })
  } catch (err) {
    console.error('GET /api/tools/contract-review/list error:', err)
    return NextResponse.json({ error: 'Failed to list reviews' }, { status: 500 })
  }
}
