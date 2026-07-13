import React from 'react'
import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { prisma } from '@/lib/prisma'
import { StageSignedCopyDocument } from '@/lib/contracts/StageSignedCopyDocument'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/v2/[token]/stage-contract-pdf
 *
 * The client's signed copy of the v2 studio contract, rendered from the
 * signoff persisted by stage-sign: negotiated-terms snapshot, studio
 * T&Cs, the studio signature — and for Hospital-Set jobs, the full
 * populated Stryker Master Media Use Agreement with its own signature
 * block, so the download is self-contained. Only available once signed.
 */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const request = await prisma.paperworkRequest.findUnique({
      where: { token: params.token },
      include: { booking: { include: { company: true } } },
    })
    if (!request) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })

    let sd: any = null
    try {
      sd = request.stageDetails ? JSON.parse(request.stageDetails) : null
    } catch {
      sd = null
    }
    const signoff = sd?.signoff
    if (!request.studioContractSigned || !signoff) {
      return NextResponse.json({ error: 'Studio contract has not been signed yet' }, { status: 404 })
    }

    // Booking start/end are date-only columns (UTC midnight) — format in
    // UTC so the rendered dates match the booking regardless of server tz.
    const fmtDate = (d?: Date | string | null) =>
      d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''

    const snap = signoff.termsSnapshot || {}
    const buffer = await renderToBuffer(
      React.createElement(StageSignedCopyDocument, {
        jobName: request.booking?.jobName || '',
        companyName: request.booking?.company?.name || '',
        rentalStart: fmtDate(request.booking?.startDate),
        rentalEnd: fmtDate(request.booking?.endDate),
        terms: {
          sets: Array.isArray(snap.sets) ? snap.sets : [],
          setLabels: snap.setLabels || undefined,
          complexAreasIncluded: Array.isArray(snap.complexAreasIncluded) ? snap.complexAreasIncluded : undefined,
          prelitSets: Array.isArray(snap.prelitSets) ? snap.prelitSets : [],
          ratePerDay: snap.ratePerDay || '',
          otRate: snap.otRate || '300',
          prepDays: snap.prepDays || '',
          shootDays: snap.shootDays || '',
          strikeDays: snap.strikeDays || '',
          darkDays: snap.darkDays || '',
          notes: snap.notes || '',
        },
        signerName: signoff.signerName || '',
        signatureImageDataUri: signoff.signatureData || '',
        signedAt: signoff.signedAt || '',
        ip: signoff.ip || '',
        stryker: signoff.stryker
          ? {
              printedName: signoff.stryker.printedName || '',
              signatureImageDataUri: signoff.stryker.signatureData || '',
              signedAt: signoff.stryker.signedAt || signoff.signedAt || '',
              fields: signoff.stryker.fields || {
                producerName: request.booking?.company?.name || 'Producer',
                producerAddress: request.booking?.company?.billingAddress || '',
                projectTitle: request.booking?.jobName || '',
                agreementDate: fmtDate(signoff.signedAt),
                returnDate: fmtDate(request.booking?.endDate),
              },
            }
          : null,
      }) as React.ReactElement<DocumentProps>,
    )

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="sirreel-studio-contract-${(request.booking?.jobName || 'signed').replace(/[^a-zA-Z0-9-_ ]/g, '').slice(0, 60)}.pdf"`,
      },
    })
  } catch (err: any) {
    console.error('[portal/v2/stage-contract-pdf]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
