import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import {
  ContractDocument,
  type AiChange,
  type DecisionForRender,
  type CompanyForRender,
  type JobForRender,
} from './ContractDocument'

export type {
  AiChange,
  DecisionForRender,
  CompanyForRender,
  JobForRender,
  ChangeDecisionValue,
  ContactForRender,
} from './ContractDocument'

export interface RenderArgs {
  company: CompanyForRender | null
  job: JobForRender | null
  aiChanges: AiChange[]
  decisions: DecisionForRender[]
  generatedAt?: Date
}

export async function generateCounterPdf(args: RenderArgs): Promise<Buffer> {
  const element = React.createElement(ContractDocument, args) as React.ReactElement<DocumentProps>
  return await renderToBuffer(element)
}
