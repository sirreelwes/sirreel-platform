/**
 * "Active COI on file — is it the right one for THIS job?"
 *
 * Wes, 2026-09-09: "there are times that productions use separate insurance
 * for whatever reason. Can we show 'Active COI on File' but ask them to
 * confirm it is the proper insurance for this job?"
 *
 * Carry-forward (./companyCoi.ts) spreads an account's approved certificate
 * over its jobs so nobody is chased for a document HQ already holds. Right
 * for the common case, silently wrong for the exception: a production
 * insured under its own policy — a co-pro, a network-supplied cert, a
 * one-off producer's package — looks covered by a certificate that never
 * named it. HQ could not tell the two apart, because the account cert
 * answers both.
 *
 * So the certificate keeps reading as ON FILE and the client is asked the
 * one question only they can answer. Three rules:
 *
 * 1. The answer is bound to the CERTIFICATE (`coiCheckId`), not to the job.
 *    File a new cert and the old confirmation stops matching, so the job
 *    asks again — the same discipline as LcdwElection.acknowledgedAgreementId.
 *    A confirmation floating free of the document proves nothing.
 * 2. Unconfirmed is NOT uninsured. `rollupCoiState` is untouched by this
 *    module: a carried approved cert is coverage whether or not anyone has
 *    confirmed it. This is an open QUESTION, not a failure.
 * 3. Only CARRIED certificates ask. One uploaded against this job was sent
 *    FOR this job.
 *
 * SEPARATE_POLICY is the one answer that changes the coverage picture: the
 * client has told us the account policy does not cover this job, so the
 * carried cert stops standing in and the job is awaiting ITS certificate.
 * That state must be RENDERED, never left as a bare "Missing" — see
 * `separatePolicySentence`.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import type { JobCoiResolution } from './companyCoi'

type Db = PrismaClient | Prisma.TransactionClient

export type CoiConfirmationState =
  /** The job has its own certificate — nothing to confirm. */
  | 'NOT_APPLICABLE'
  /** Carried cert, never answered — or answered about a DIFFERENT one. */
  | 'NEEDED'
  /** Yes, the account policy covers this job. */
  | 'CONFIRMED'
  /** This job is insured separately; its certificate is still outstanding. */
  | 'SEPARATE_POLICY'

export interface JobCoiConfirmationView {
  state: CoiConfirmationState
  /** Answered, but about a certificate that has since been superseded. The
   *  old answer is shown for context and the question is asked again. */
  aboutSupersededCoi: boolean
  decidedAt: Date | null
  confirmerName: string | null
  note: string | null
  /** The certificate the stored answer was about. */
  coiCheckId: string | null
}

export const NO_CONFIRMATION: JobCoiConfirmationView = {
  state: 'NOT_APPLICABLE',
  aboutSupersededCoi: false,
  decidedAt: null,
  confirmerName: null,
  note: null,
  coiCheckId: null,
}

/**
 * The confirmation state for a job, given the certificate that governs it.
 *
 * Pass the resolution from `resolveJobCoi`. A null resolution still resolves
 * to a real state: a client who declared a separate policy and has not sent
 * it yet has no governing certificate but very much has an answer on file.
 */
export async function getJobCoiConfirmation(
  jobId: string,
  resolution: JobCoiResolution | null,
  db: Db = defaultPrisma,
): Promise<JobCoiConfirmationView> {
  // The job's own certificate was sent for this job. Never ask.
  if (resolution?.source === 'JOB') return NO_CONFIRMATION

  const row = await db.jobCoiConfirmation.findUnique({
    where: { jobId },
    select: {
      decision: true,
      decidedAt: true,
      confirmerName: true,
      note: true,
      coiCheckId: true,
    },
  })

  if (!row) {
    return resolution
      ? { ...NO_CONFIRMATION, state: 'NEEDED' }
      : NO_CONFIRMATION // no cert at all — the ask is for the certificate itself
  }

  const base = {
    aboutSupersededCoi: false,
    decidedAt: row.decidedAt,
    confirmerName: row.confirmerName,
    note: row.note,
    coiCheckId: row.coiCheckId,
  }

  // SEPARATE_POLICY is a statement about the JOB, not about one document:
  // "we carry our own insurance for this". A newer account cert does not
  // undo it — only the job's own certificate arriving does, and that is
  // handled by the NOT_APPLICABLE branch above.
  if (row.decision === 'SEPARATE_POLICY') return { ...base, state: 'SEPARATE_POLICY' }

  // CONFIRMED is a statement about one document. If the account has since
  // filed a different certificate, the answer no longer covers what is on
  // file, and we ask again rather than inferring the client would have said
  // the same thing about a document they never saw.
  if (resolution && row.coiCheckId !== resolution.coi.id) {
    return { ...base, state: 'NEEDED', aboutSupersededCoi: true }
  }
  if (!resolution) return { ...base, state: 'NEEDED', aboutSupersededCoi: true }

  return { ...base, state: 'CONFIRMED' }
}

/**
 * Does the carried certificate still stand in for this job?
 *
 * False only once the client has told us it does not. An UNANSWERED job
 * keeps its coverage — rule 2.
 */
export function carriedCoiApplies(c: JobCoiConfirmationView): boolean {
  return c.state !== 'SEPARATE_POLICY'
}

/** What the client is asked, and what the answer stores as having been said. */
export function confirmationQuestion(companyName?: string | null): string {
  const who = companyName ? `${companyName}'s` : 'your company’s'
  return `Is ${who} certificate of insurance on file the right coverage for this job?`
}

export function confirmationAcknowledgment(
  companyName: string | null | undefined,
  coiFilename: string,
  expiry: Date | null,
): string {
  const who = companyName ? `${companyName}'s` : 'our'
  const through = expiry
    ? `, in effect through ${expiry.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`
    : ''
  return `I confirm that ${who} certificate of insurance on file (${coiFilename}${through}) is the correct coverage for this job.`
}

/** Rendered wherever a job is awaiting the client's own certificate. */
export function separatePolicySentence(c: JobCoiConfirmationView): string {
  if (c.state !== 'SEPARATE_POLICY') return ''
  const who = c.confirmerName ? `${c.confirmerName} told us` : 'The production told us'
  return `${who} this job is insured under its own policy, not the account certificate — we still need that certificate before pickup.`
}

/** Staff-facing word for the chip beside the COI verdict. */
export const COI_CONFIRMATION_WORD: Record<CoiConfirmationState, string> = {
  NOT_APPLICABLE: '',
  NEEDED: 'Unconfirmed for this job',
  CONFIRMED: 'Confirmed for this job',
  SEPARATE_POLICY: 'Own policy — cert outstanding',
}
