import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import {
  StageContractDocument,
  type StageContractPartyForRender,
  type StageBookingTermsForRender,
  type StageContractSignatureForRender,
} from './StageContractDocument'

export type {
  StageContractPartyForRender,
  StageBookingTermsForRender,
  StageContractSignatureForRender,
} from './StageContractDocument'

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

/**
 * Render the EXECUTED stage contract — the same document body the client
 * reviewed, plus the Producer signature, the e-sign attestation and the
 * audit trail (timestamp, email, IP, device).
 *
 * The caller must upload this and only then flip the SignedAgreement to a
 * SIGNED status: a status without an artifact is worse than a failed sign,
 * because the client believes it's done and there's no paper to show.
 */
export async function generateSignedStageContractPdf(
  args: StageContractRenderArgs & { signature: StageContractSignatureForRender },
): Promise<Buffer> {
  const element = React.createElement(StageContractDocument, args) as React.ReactElement<DocumentProps>
  return await renderToBuffer(element)
}
