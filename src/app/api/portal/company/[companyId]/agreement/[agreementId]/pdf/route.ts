/**
 * GET /api/portal/company/[companyId]/agreement/[agreementId]/pdf
 *
 * Two documents share this route because the reader does not distinguish
 * them — "let me read the agreement" is the same click whether the paper is
 * the company's annual master or one show's countersigned copy:
 *
 *   default        → CompanyAgreement (the filed master / annual)
 *   ?kind=signed   → SignedAgreement  (one order's signed copy)
 *
 * Both are scoped to the session's COMPANY, and the signed copy is scoped
 * through its order's job so a signed agreement id from another account
 * resolves to nothing.
 *
 * A COVERED agreement row has no document of its own — it is papered by the
 * annual master or by a sibling order's signature. Serving the covering
 * document under its id would show the reader someone else's paperwork
 * while labelling it as this order's, so a covered row is a 404 here and
 * the UI never offers the link (see companyJobDetail.ts `hasPdf`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyPortalSessionFromRequest } from '@/lib/portal/companyPortal'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

const SIGNED_STATUSES = ['SIGNED_BASELINE', 'SIGNED_NEGOTIATED', 'SIGNED_OFFLINE']

export async function GET(
  req: NextRequest,
  { params }: { params: { companyId: string; agreementId: string } },
) {
  const session = await getCompanyPortalSessionFromRequest(req, params.companyId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const wantDownload = req.nextUrl.searchParams.get('download') === '1'

  if (req.nextUrl.searchParams.get('kind') === 'signed') {
    const signed = await prisma.signedAgreement.findFirst({
      where: {
        id: params.agreementId,
        order: { job: { companyId: session.companyId } },
      },
      select: {
        status: true,
        signedDocumentUrl: true,
        order: { select: { orderNumber: true } },
      },
    })
    if (!signed || !signed.signedDocumentUrl) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    // Only a real signature has a copy to read.
    if (!SIGNED_STATUSES.includes(signed.status)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return streamPrivateBlobAsResponse({
      fileUrl: signed.signedDocumentUrl,
      filename: `Rental-Agreement-${signed.order.orderNumber}.pdf`,
      forceDownload: wantDownload,
    })
  }

  const master = await prisma.companyAgreement.findFirst({
    where: { id: params.agreementId, companyId: session.companyId, deletedAt: null },
    select: { fileUrl: true, originalFilename: true, title: true },
  })
  if (!master) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return streamPrivateBlobAsResponse({
    fileUrl: master.fileUrl,
    filename: master.originalFilename || `${master.title || 'agreement'}.pdf`,
    forceDownload: wantDownload,
  })
}
