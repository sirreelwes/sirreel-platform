/**
 * GET /api/portal/account/job/[jobId]/agreement/[agreementId]/pdf
 *
 * The PERSON portal's copy of a show's paperwork. Same two documents as the
 * company route, same rule about covered rows (no document of their own,
 * so a 404 — see companyJobDetail.ts `hasPdf`):
 *
 *   ?kind=signed   → SignedAgreement, scoped to an order on THIS job
 *   default        → CompanyAgreement (the annual master) of the job's company
 *
 * 404, never 403.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getPersonJobAccessFromRequest } from '@/lib/portal/personJobAccess'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

const SIGNED_STATUSES = ['SIGNED_BASELINE', 'SIGNED_NEGOTIATED', 'SIGNED_OFFLINE']

export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string; agreementId: string } },
) {
  const access = await getPersonJobAccessFromRequest(req, params.jobId)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const wantDownload = req.nextUrl.searchParams.get('download') === '1'

  if (req.nextUrl.searchParams.get('kind') === 'signed') {
    const signed = await prisma.signedAgreement.findFirst({
      where: { id: params.agreementId, order: { jobId: access.jobId } },
      select: { status: true, signedDocumentUrl: true, order: { select: { orderNumber: true } } },
    })
    if (!signed?.signedDocumentUrl || !SIGNED_STATUSES.includes(signed.status)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return streamPrivateBlobAsResponse({
      fileUrl: signed.signedDocumentUrl,
      filename: `Rental-Agreement-${signed.order.orderNumber}.pdf`,
      forceDownload: wantDownload,
    })
  }

  const master = await prisma.companyAgreement.findFirst({
    where: { id: params.agreementId, companyId: access.companyId, deletedAt: null },
    select: { fileUrl: true, originalFilename: true, title: true },
  })
  if (!master) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return streamPrivateBlobAsResponse({
    fileUrl: master.fileUrl,
    filename: master.originalFilename || `${master.title || 'agreement'}.pdf`,
    forceDownload: wantDownload,
  })
}
