/**
 * GET /api/admin/negotiated-agreements
 *
 * Registry list of every Company that carries a recorded standing
 * (negotiated) agreement — i.e. negotiatedTermsApprovedAt is set.
 * Powers the admin registry view at /admin/negotiated-agreements.
 *
 * Auth: getServerSession. Read-only.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const companies = await prisma.company.findMany({
    where: { negotiatedTermsApprovedAt: { not: null } },
    select: {
      id: true,
      name: true,
      tier: true,
      negotiatedTermsUrl: true,
      negotiatedTermsSummary: true,
      negotiatedTermsNegotiatedAt: true,
      negotiatedTermsApprovedBy: true,
      negotiatedTermsApprovedAt: true,
      negotiatedTermsActiveAsOf: true,
      negotiatedTermsReviewDueDate: true,
    },
    orderBy: { negotiatedTermsApprovedAt: 'desc' },
  })

  return NextResponse.json({ companies })
}
