import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import {
  ContractDocument,
  type AiChange,
  type DecisionForRender,
  type CompanyForRender,
  type JobForRender,
  type GrantedScopeEntry,
} from './ContractDocument'

export type {
  AiChange,
  DecisionForRender,
  CompanyForRender,
  JobForRender,
  ChangeDecisionValue,
  ContactForRender,
  GrantedScopeEntry,
} from './ContractDocument'

export interface RenderArgs {
  company: CompanyForRender | null
  job: JobForRender | null
  aiChanges: AiChange[]
  decisions: DecisionForRender[]
  generatedAt?: Date
  grantedScope?: { packageName: string; items: GrantedScopeEntry[] } | null
  /** Header/metadata title. Omit for the counter flow (defaults to the
   *  counter-proposal label); the baseline doc-to-sign passes "Rental
   *  Agreement". Presentation only — no effect on clause text. */
  documentTitle?: string
}

export async function generateCounterPdf(args: RenderArgs): Promise<Buffer> {
  const element = React.createElement(ContractDocument, args) as React.ReactElement<DocumentProps>
  return await renderToBuffer(element)
}
