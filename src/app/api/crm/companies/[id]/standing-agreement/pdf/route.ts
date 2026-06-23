/**
 * GET /api/crm/companies/[id]/standing-agreement/pdf
 *
 * Session-gated proxy for a company's negotiated standing-agreement PDF.
 * The PDF lives in the PRIVATE Blob store (see the sibling POST in
 * ../route.ts, flipped to `access:'private'` in the c19e928/bf9516f
 * sweep), so `Company.negotiatedTermsUrl` 403s on a direct fetch and
 * can't be linked raw. This streams it back through the shared
 * `streamPrivateBlobAsResponse` helper for any authenticated HQ user.
 *
 * Consumers (all dashboard, same-origin → cookie session): the CRM
 * company detail page, the admin negotiated-agreements registry, and the
 * order-detail standing-agreement banner.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const company = await prisma.company.findUnique({
    where: { id },
    select: { name: true, negotiatedTermsUrl: true },
  })
  if (!company) {
    return NextResponse.json({ error: 'Company not found' }, { status: 404 })
  }
  if (!company.negotiatedTermsUrl) {
    return NextResponse.json({ error: 'No negotiated agreement on file' }, { status: 404 })
  }

  const safeCompany = company.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'company'
  return streamPrivateBlobAsResponse({
    fileUrl: company.negotiatedTermsUrl,
    filename: `${safeCompany}-negotiated-terms.pdf`,
  })
}
