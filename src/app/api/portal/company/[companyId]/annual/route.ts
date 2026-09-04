/** GET /api/portal/company/[companyId]/annual — the annual offered to this
 *  account (if any) and who's signing. Session-gated like everything here. */
import { NextRequest, NextResponse } from 'next/server'
import { getCompanyPortalSessionFromRequest } from '@/lib/portal/companyPortal'
import { findPendingAnnual } from '@/lib/portal/companyAnnual'
import { findCompanyAnnualCoverage } from '@/lib/orders/annualCoverage'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { companyId: string } }) {
  const session = await getCompanyPortalSessionFromRequest(req, params.companyId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const [pending, current] = await Promise.all([
    findPendingAnnual(session.companyId),
    findCompanyAnnualCoverage(session.companyId),
  ])
  return NextResponse.json({
    ok: true,
    companyName: session.companyName,
    signer: { name: session.personName, email: session.personEmail, title: session.title },
    pending,
    current: current
      ? { id: current.companyAgreementId, title: current.title, expiryDate: current.expiryDate, signerName: current.signerName, signedAt: current.signedAt }
      : null,
  })
}
