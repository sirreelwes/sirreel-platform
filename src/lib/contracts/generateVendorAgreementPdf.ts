import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { VendorAgreementDocument, type VendorAgreementPartyForRender } from './VendorAgreementDocument'

export type { VendorAgreementPartyForRender } from './VendorAgreementDocument'

/** Render the unsigned Partner Vehicle Agreement for one partner. The caller
 *  files it through uploadVendorAgreement so it lands in the same sign flow
 *  as a hand-uploaded PDF. */
export async function generateVendorAgreementPdf(args: { partner: VendorAgreementPartyForRender; generatedAt?: Date }): Promise<Buffer> {
  const element = React.createElement(VendorAgreementDocument, args) as React.ReactElement<DocumentProps>
  return await renderToBuffer(element)
}
