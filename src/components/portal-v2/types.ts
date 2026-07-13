/**
 * Portal v2 shared types. The v2 guided portal renders against the SAME
 * data the legacy /portal/[token] page fetches (GET /api/portal/[token]),
 * so these interfaces describe just the slices the v2 cards read.
 */

export interface V2Intake {
  fullName: string
  title: string
  company: string
  email: string
  phone: string
  billingAddress1: string
  billingAddress2: string
  billingCity: string
  billingState: string
  billingZip: string
}

export const EMPTY_INTAKE: V2Intake = {
  fullName: '',
  title: '',
  company: '',
  email: '',
  phone: '',
  billingAddress1: '',
  billingAddress2: '',
  billingCity: '',
  billingState: '',
  billingZip: '',
}

/** Completion flags mapped 1:1 from PaperworkRequest booleans. */
export interface V2Done {
  agreement: boolean
  lcdw: boolean
  studio: boolean
  coi: boolean
  cc: boolean
}

export type V2DocKey = keyof V2Done

/** Glanceable card status rendered by CardShell. */
export type V2CardStatus = 'todo' | 'pending' | 'attention' | 'done' | 'locked'

/** Dual-path SignedAgreement state (GET /api/portal/[token]/agreement). */
export interface V2AgreementState {
  status: string
  documentToSignUrl: string | null
  wordDocumentAvailable: boolean
  allowedActions: string[]
  statusUpdatedAt: string
  job?: { company?: string }
  timeline?: { kind: string; label: string; at: string }[]
}

export interface V2Booking {
  jobName: string
  startDate?: string
  endDate?: string
  status: string
  depositAmount?: string | number | null
  company?: { name?: string; billingAddress?: string | null }
  person?: { firstName?: string; lastName?: string; email?: string; phone?: string; mobile?: string }
  agent?: { name?: string; email?: string }
}

export interface V2Paperwork {
  contractType?: string
  stageDetails?: string | null
  signerName?: string | null
  rentalAgreement?: boolean
  lcdwAccepted?: boolean
  studioContractSigned?: boolean
  creditCardAuth?: boolean
  coiReceived?: boolean
  wcReceived?: boolean
  coi_ai_review?: any
}
