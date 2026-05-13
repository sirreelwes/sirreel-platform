import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import {
  SignedAgreementDocument,
  type SignedAgreementDocumentProps,
} from './SignedAgreementDocument'

export async function generateSignedAgreementPdf(
  props: SignedAgreementDocumentProps,
): Promise<Buffer> {
  const element = React.createElement(SignedAgreementDocument, props) as React.ReactElement<DocumentProps>
  return await renderToBuffer(element)
}
