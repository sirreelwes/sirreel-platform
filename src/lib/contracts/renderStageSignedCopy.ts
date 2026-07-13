import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { StageSignedCopyDocument, type StageSignedCopyProps } from './StageSignedCopyDocument'

/**
 * Shared renderer for the signed v2 studio-contract PDF.
 *
 * ONE definition of the document's content, used by BOTH:
 *  - GET /api/portal/v2/[token]/stage-contract-pdf (on-demand download)
 *  - POST /api/portal/v2/[token]/stage-sign (post-signing render for the
 *    Blob artifact + internal staff email)
 * so the stored artifact, the emailed attachment, and the client's
 * download are guaranteed identical for a given signoff snapshot.
 */

interface RequestForRender {
  booking?: {
    jobName?: string | null
    startDate?: Date | string | null
    endDate?: Date | string | null
    company?: { name?: string | null; billingAddress?: string | null } | null
  } | null
}

const fmtDateUTC = (d?: Date | string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''

export function buildStageSignedCopyProps(request: RequestForRender, signoff: any): StageSignedCopyProps {
  const snap = signoff?.termsSnapshot || {}
  return {
    jobName: request.booking?.jobName || '',
    companyName: request.booking?.company?.name || '',
    rentalStart: fmtDateUTC(request.booking?.startDate),
    rentalEnd: fmtDateUTC(request.booking?.endDate),
    terms: {
      sets: Array.isArray(snap.sets) ? snap.sets : [],
      setLabels: snap.setLabels || undefined,
      complexAreasIncluded: Array.isArray(snap.complexAreasIncluded) ? snap.complexAreasIncluded : undefined,
      ledWallTechLabel: snap.ledWall?.techLabel || undefined,
      prelitSets: Array.isArray(snap.prelitSets) ? snap.prelitSets : [],
      ratePerDay: snap.ratePerDay || '',
      otRate: snap.otRate || '300',
      prepDays: snap.prepDays || '',
      shootDays: snap.shootDays || '',
      strikeDays: snap.strikeDays || '',
      darkDays: snap.darkDays || '',
      notes: snap.notes || '',
    },
    signerName: signoff?.signerName || '',
    signatureImageDataUri: signoff?.signatureData || '',
    signedAt: signoff?.signedAt || '',
    ip: signoff?.ip || '',
    stryker: signoff?.stryker
      ? {
          printedName: signoff.stryker.printedName || '',
          signatureImageDataUri: signoff.stryker.signatureData || '',
          signedAt: signoff.stryker.signedAt || signoff.signedAt || '',
          fields: signoff.stryker.fields || {
            producerName: request.booking?.company?.name || 'Producer',
            producerAddress: request.booking?.company?.billingAddress || '',
            projectTitle: request.booking?.jobName || '',
            agreementDate: fmtDateUTC(signoff?.signedAt),
            returnDate: fmtDateUTC(request.booking?.endDate),
          },
        }
      : null,
  }
}

export async function renderStageSignedCopyPdf(request: RequestForRender, signoff: any): Promise<Buffer> {
  const element = React.createElement(
    StageSignedCopyDocument,
    buildStageSignedCopyProps(request, signoff),
  ) as React.ReactElement<DocumentProps>
  return await renderToBuffer(element)
}
