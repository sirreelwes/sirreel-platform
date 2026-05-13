import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveAgreementToken } from '@/lib/portal/agreementToken'
import { ensureSignedAgreementForOrder } from '@/lib/orders/signedAgreement'
import type { AgreementStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

type AllowedAction = 'sign' | 'download' | 'upload-redline' | 'view-signed'

function allowedActionsFor(status: AgreementStatus): AllowedAction[] {
  switch (status) {
    case 'PORTAL_GENERATED':
      return ['sign', 'download']
    case 'DOWNLOAD_SENT':
      return ['sign', 'upload-redline']
    case 'REDLINE_UPLOADED':
    case 'UNDER_REVIEW':
      return []
    case 'NEGOTIATED_READY':
      return ['sign']
    case 'SIGNED_BASELINE':
    case 'SIGNED_NEGOTIATED':
      return ['view-signed']
    default:
      return []
  }
}

function fmtDateOnly(d: Date | null): string {
  if (!d) return ''
  return d.toISOString().slice(0, 10)
}

/**
 * GET /api/portal/[token]/agreement
 *
 * Returns the SignedAgreement state-machine view the portal UI renders against.
 * Auto-creates the SignedAgreement record on first read if one doesn't exist
 * — covers the edge case where the order's quoteStatus never went through
 * the PUT handler that normally fires the ensure-helper.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const resolved = await resolveAgreementToken(params.token)
  if (!resolved) {
    return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 })
  }

  if (!resolved.agreement) {
    await ensureSignedAgreementForOrder(resolved.order.id)
  }

  const agreement = await prisma.signedAgreement.findUnique({
    where: { orderId: resolved.order.id },
    select: {
      status: true,
      documentType: true,
      documentToSignUrl: true,
      wordDocumentUrl: true,
      signedDocumentUrl: true,
      signedAt: true,
      signerName: true,
      updatedAt: true,
    },
  })
  if (!agreement) {
    return NextResponse.json({ error: 'Agreement not available' }, { status: 500 })
  }

  return NextResponse.json({
    status: agreement.status,
    documentType: agreement.documentType,
    documentToSignUrl: agreement.documentToSignUrl,
    wordDocumentAvailable: !!agreement.wordDocumentUrl || agreement.status === 'PORTAL_GENERATED',
    allowedActions: allowedActionsFor(agreement.status),
    job: {
      name: resolved.order.job?.name || '',
      number: resolved.order.job?.jobCode || resolved.order.orderNumber,
      company: resolved.order.company.name,
      rentalStart: fmtDateOnly(resolved.order.startDate),
      rentalEnd: fmtDateOnly(resolved.order.endDate),
    },
    signedAt: agreement.signedAt ? agreement.signedAt.toISOString() : null,
    signerName: agreement.signerName,
    statusUpdatedAt: agreement.updatedAt.toISOString(),
  })
}
