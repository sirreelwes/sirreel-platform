/**
 * GET /api/exec/approvals — Card A backing data.
 *
 * Returns the four buckets the Exec/Coverage approvals queue surfaces:
 *
 *   1. contractReviews  — ContractReview rows with humanDecision=PENDING
 *   2. coiChecks        — CoiCheck rows with humanDecision=PENDING (carry aiRiskLevel)
 *   3. changeDecisions  — ReviewChangeDecision rows with decision=PENDING
 *   4. renewals         — Companies whose annualAgreementExpiresAt or
 *                         annualCoiExpiresAt falls within RENEWAL_WINDOW_DAYS
 *                         (or has already passed). Negative deltas surface
 *                         as "expired N days ago".
 *
 * Each bucket carries a `count` and an `items` list. Per the brief:
 *   - Sort approval items oldest-pending first (createdAt asc), then by
 *     risk (high > medium > low > null) as a tiebreaker.
 *   - Renewals sort by absolute proximity to "now" — already-expired
 *     first (most negative delta), then soonest-to-expire.
 *
 * Role-gated via the shared coverage guard. The legacy /api/tools/*
 * endpoints are left untouched per direction.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCoverageAccess } from '@/lib/exec/requireCoverageAccess'
import { RENEWAL_WINDOW_DAYS } from '@/lib/exec/thresholds'

export const dynamic = 'force-dynamic'

const RISK_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

function riskRank(level: string | null | undefined): number {
  if (!level) return 3
  return RISK_ORDER[level.toLowerCase()] ?? 3
}

export async function GET() {
  const guard = await requireCoverageAccess()
  if (!guard.ok) return guard.response

  const now = new Date()
  const renewalCutoff = new Date(now.getTime() + RENEWAL_WINDOW_DAYS * 86_400_000)

  const [contractReviews, coiChecks, changeDecisions, renewalCompanies] = await Promise.all([
    prisma.contractReview.findMany({
      where: { humanDecision: 'PENDING', deletedAt: null },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        createdAt: true,
        originalFilename: true,
        aiRiskLevel: true,
        aiRecommendation: true,
        company: { select: { id: true, name: true } },
        job: { select: { id: true, jobCode: true, name: true } },
      },
    }),
    prisma.coiCheck.findMany({
      where: { humanDecision: 'PENDING', deletedAt: null },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        createdAt: true,
        originalFilename: true,
        aiRiskLevel: true,
        aiRecommendation: true,
        policyExpiryDate: true,
        company: { select: { id: true, name: true } },
        job: { select: { id: true, jobCode: true, name: true } },
      },
    }),
    prisma.reviewChangeDecision.findMany({
      where: { decision: 'PENDING' },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        createdAt: true,
        clauseRef: true,
        changeType: true,
        review: {
          select: {
            id: true,
            originalFilename: true,
            aiRiskLevel: true,
            company: { select: { id: true, name: true } },
            job: { select: { id: true, jobCode: true, name: true } },
          },
        },
      },
    }),
    prisma.company.findMany({
      where: {
        OR: [
          { annualAgreementExpiresAt: { lte: renewalCutoff } },
          { annualCoiExpiresAt: { lte: renewalCutoff } },
        ],
      },
      select: {
        id: true,
        name: true,
        annualAgreementExpiresAt: true,
        annualCoiExpiresAt: true,
        defaultAgent: { select: { id: true, name: true } },
      },
    }),
  ])

  // Sort within each bucket: oldest-pending first, then by risk.
  contractReviews.sort((a, b) => {
    const t = a.createdAt.getTime() - b.createdAt.getTime()
    return t !== 0 ? t : riskRank(a.aiRiskLevel) - riskRank(b.aiRiskLevel)
  })
  coiChecks.sort((a, b) => {
    const t = a.createdAt.getTime() - b.createdAt.getTime()
    return t !== 0 ? t : riskRank(a.aiRiskLevel) - riskRank(b.aiRiskLevel)
  })
  // ChangeDecisions don't carry their own risk; tiebreak by parent review's risk.
  changeDecisions.sort((a, b) => {
    const t = a.createdAt.getTime() - b.createdAt.getTime()
    return t !== 0 ? t : riskRank(a.review.aiRiskLevel) - riskRank(b.review.aiRiskLevel)
  })

  // Reshape renewal rows: a company can appear once per expiring artifact
  // (agreement, COI, or both). Project to one row per (companyId, kind).
  type RenewalItem = {
    companyId: string
    companyName: string
    kind: 'agreement' | 'coi'
    expiresAt: Date
    /** days from now (negative = already expired) */
    daysFromNow: number
    defaultAgent: { id: string; name: string } | null
  }
  const renewals: RenewalItem[] = []
  for (const c of renewalCompanies) {
    if (c.annualAgreementExpiresAt && c.annualAgreementExpiresAt.getTime() <= renewalCutoff.getTime()) {
      renewals.push({
        companyId: c.id,
        companyName: c.name,
        kind: 'agreement',
        expiresAt: c.annualAgreementExpiresAt,
        daysFromNow: Math.round((c.annualAgreementExpiresAt.getTime() - now.getTime()) / 86_400_000),
        defaultAgent: c.defaultAgent,
      })
    }
    if (c.annualCoiExpiresAt && c.annualCoiExpiresAt.getTime() <= renewalCutoff.getTime()) {
      renewals.push({
        companyId: c.id,
        companyName: c.name,
        kind: 'coi',
        expiresAt: c.annualCoiExpiresAt,
        daysFromNow: Math.round((c.annualCoiExpiresAt.getTime() - now.getTime()) / 86_400_000),
        defaultAgent: c.defaultAgent,
      })
    }
  }
  // Already-expired (negative daysFromNow) first, then soonest-to-expire.
  renewals.sort((a, b) => a.daysFromNow - b.daysFromNow)

  const totalCount =
    contractReviews.length + coiChecks.length + changeDecisions.length + renewals.length

  return NextResponse.json({
    now: now.toISOString(),
    renewalWindowDays: RENEWAL_WINDOW_DAYS,
    totalCount,
    contractReviews: { count: contractReviews.length, items: contractReviews },
    coiChecks: { count: coiChecks.length, items: coiChecks },
    changeDecisions: { count: changeDecisions.length, items: changeDecisions },
    renewals: { count: renewals.length, items: renewals },
  })
}
