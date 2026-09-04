/**
 * GET /api/portal/company/[companyId]/logo — the client's own mark, for
 * their account portal hero.
 *
 * Session-gated rather than public: the logo lives in the private blob
 * store, and a public route keyed by company id would make the
 * company-id → client mapping enumerable. See the Company.logoUrl comment.
 *
 * Cached privately for an hour — a logo changes about never, and the hero
 * shouldn't re-fetch it on every navigation. `private` keeps it out of any
 * shared cache, since the response is only valid for this reader.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyPortalSessionFromRequest } from '@/lib/portal/companyPortal'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { companyId: string } }) {
  const session = await getCompanyPortalSessionFromRequest(req, params.companyId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const company = await prisma.company.findUnique({
    where: { id: session.companyId },
    select: { logoUrl: true, name: true },
  })
  if (!company?.logoUrl) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const res = await streamPrivateBlobAsResponse({
    fileUrl: company.logoUrl,
    filename: `${company.name.replace(/[^A-Za-z0-9._-]+/g, '-')}-logo`,
  })
  res.headers.set('Cache-Control', 'private, max-age=3600')
  return res
}
