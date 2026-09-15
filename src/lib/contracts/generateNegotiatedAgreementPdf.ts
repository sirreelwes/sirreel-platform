/**
 * Render a client's negotiated agreement to a PDF buffer.
 *
 * Same renderToBuffer path as generateCounterPdf — React-PDF, no Puppeteer,
 * so it runs identically in a script, a route and a test.
 */
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { NegotiatedAgreementDocument, type NegotiatedDocProps } from './NegotiatedAgreementDocument'

export async function generateNegotiatedAgreementPdf(props: NegotiatedDocProps): Promise<Buffer> {
  const element = React.createElement(NegotiatedAgreementDocument, props)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(element as any)
}
