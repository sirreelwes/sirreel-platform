import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import {
  StageContractDocument,
  type StageContractPartyForRender,
  type StageBookingTermsForRender,
} from './StageContractDocument'

export type { StageContractPartyForRender, StageBookingTermsForRender } from './StageContractDocument'

export interface StageContractRenderArgs {
  party: StageContractPartyForRender
  terms: StageBookingTermsForRender
  generatedAt?: Date
}

/**
 * Render the SirReel Stage Contract to a PDF buffer. Mirrors
 * generateCounterPdf — no Puppeteer, just React-PDF's `renderToBuffer`
 * which runs in any Node context (server route, cron job, test).
 *
 * The returned buffer is the canonical pre-signed PDF (Wes side filled
 * in via typed name; Producer side blank for portal countersign). The
 * caller is responsible for uploading it to Vercel Blob and persisting
 * the URL on a SignedAgreement row with contractType=STAGE_CONTRACT.
 */
export async function generateStageContractPdf(args: StageContractRenderArgs): Promise<Buffer> {
  const element = React.createElement(StageContractDocument, args) as React.ReactElement<DocumentProps>
  return await renderToBuffer(element)
}
