/**
 * GET /api/crm/companies/[id]/agreements — the masters filed for a company,
 * with which one (if any) is currently auto-covering its jobs.
 *
 * The job-scoped sibling at /api/jobs/[id]/agreements answers "what covers
 * THIS job". This one answers "how is this account set up", which is the
 * question the CRM page asks and the one an annual account is configured
 * from.
 *
 * `coveringId` is DERIVED here rather than read off the flag, because
 * auto-cover requires a current window as well as the opt-in. Rendering the
 * flag alone would show an expired 2025 master as active — and quietly
 * covering nothing.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { findCompanyAnnualCoverage, isCoverageCurrent } from '@/lib/orders/annualCoverage'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const company = await prisma.company.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  })
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [rows, coverage] = await Promise.all([
    prisma.companyAgreement.findMany({
      where: { companyId: company.id, deletedAt: null },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, contractType: true, title: true, isAnnual: true, autoCoverJobs: true,
        effectiveDate: true, expiryDate: true, signerName: true, signedAt: true,
        standingLcdwDecision: true,
        originalFilename: true, createdAt: true, deletedAt: true,
        _count: { select: { addenda: true } },
      },
    }),
    findCompanyAnnualCoverage(company.id),
  ])

  const now = new Date()
  return NextResponse.json({
    company,
    coveringId: coverage?.companyAgreementId ?? null,
    agreements: rows.map((a) => ({
      id: a.id,
      contractType: a.contractType,
      title: a.title,
      isAnnual: a.isAnnual,
      autoCoverJobs: a.autoCoverJobs,
      effectiveDate: a.effectiveDate,
      expiryDate: a.expiryDate,
      signerName: a.signerName,
      signedAt: a.signedAt,
      standingLcdwDecision: a.standingLcdwDecision,
      originalFilename: a.originalFilename,
      createdAt: a.createdAt,
      jobsAttached: a._count.addenda,
      // Flagged but NOT covering — the window has lapsed or not opened yet.
      // Surfaced so "why is this client being asked to sign?" is answerable
      // from the page that configured it.
      flaggedButInactive: a.autoCoverJobs && !isCoverageCurrent(a, now),
    })),
  })
}
