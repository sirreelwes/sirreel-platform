/**
 * POST /api/portal/company/[companyId]/annual-request — the same ask, made
 * from the account portal's terms block, where it used to be a sentence
 * telling the client to phone their rep.
 *
 * Session-gated like everything under /api/portal/company. Recording only —
 * the annual is filed by staff and signed at /portal/company/[id]/sign/annual.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCompanyPortalSessionFromRequest } from '@/lib/portal/companyPortal'
import { recordAnnualRequest } from '@/lib/portal/annualRequest'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { companyId: string } }) {
  const session = await getCompanyPortalSessionFromRequest(req, params.companyId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const request = await recordAnnualRequest({
    companyId: session.companyId,
    personId: session.personId ?? null,
    name: session.personName ?? null,
    email: session.personEmail ?? null,
    source: 'ACCOUNT_PORTAL',
  })

  return NextResponse.json({ ok: true, requestedAt: request.createdAt.toISOString() })
}
