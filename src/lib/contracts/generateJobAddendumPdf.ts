import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { JobAddendumDocument, type JobAddendumProps } from './JobAddendumDocument'

export type { JobAddendumProps, JobAddendumSignature } from './JobAddendumDocument'

export async function generateJobAddendumPdf(args: JobAddendumProps): Promise<Buffer> {
  const element = React.createElement(JobAddendumDocument, args) as React.ReactElement<DocumentProps>
  return await renderToBuffer(element)
}
