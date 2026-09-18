/**
 * "Do we still need insurance paperwork from this client?" — one answer, for
 * every portal that asks.
 *
 * Christopher Helmic, first time through the portal on Pilot Pen
 * (2026-09-18): "I added the COI and sent it to agent … The CC section
 * requires us to add the COI again, plus the WC (which is requested but it
 * doesn't feature a separate upload section on the first page)."
 *
 * He was right on both counts, and both were ours:
 *
 *   1. The job portal (/portal/job/[slug]) files a client's certificate as a
 *      CoiCheck on the JOB. The paperwork portal — which the job portal's own
 *      Card Authorization row hands him to, at /portal/v2/<token>?open=cc —
 *      read `PaperworkRequest.coi_received` and nothing else. Two records for
 *      one certificate, so the second screen asked for the document the first
 *      screen had already taken.
 *
 *   2. `wc_received` was written by exactly ONE route, the separate
 *      workers'-comp upload. Workers' comp normally rides on the certificate
 *      itself, so for the ordinary client that flag could never become true:
 *      the insurance step stayed outstanding forever and went on asking for a
 *      document that was already in the PDF above it.
 *
 * So this is computed on READ, the way the named-insured verdict and the
 * broker desk's verdicts are: whatever door a certificate came through, and
 * whoever fixes the record later, the client stops being asked for it.
 *
 * PURE — rows in, verdict out, no prisma, so `npm run test:portal-insurance`
 * can pin the reasons. The DB half is insuranceOnFile.ts.
 */
import { coiCarriesWorkersComp } from '@/lib/coi/checks'
import type { CoiAiResponse } from '@/lib/coi/reviewCoi'

/** Where the proof came from, so a surface can SAY it rather than imply it. */
export type InsuranceProof =
  /** Recorded against this paperwork request already. */
  | 'REQUEST'
  /** A certificate filed on this job — by the client, the drop link, or staff. */
  | 'JOB'
  /** The account's certificate on file, carried forward to this job. */
  | 'COMPANY'
  /** Workers' comp sits on the certificate of insurance itself. */
  | 'ON_COI'

export interface InsuranceCertificate {
  source: 'JOB' | 'COMPANY'
  filename: string | null
  uploadedAt: Date | string | null
  /** ReviewDecision as a string — PENDING / APPROVED / REJECTED / COUNTERED. */
  humanDecision: string
  policyExpiryDate: Date | string | null
  /** Did the CRITICAL checks pass on the AI read? (CoiCheck.coverageVerified) */
  coverageVerified?: boolean
  /** The stored AI review of that certificate, for the workers' comp read. */
  aiResponse?: unknown
}

export interface InsuranceStepInputs {
  /** PaperworkRequest.coi_received */
  coiReceived: boolean
  /** PaperworkRequest.wc_received */
  wcReceived: boolean
  /** PaperworkRequest.coi_ai_review — the portal's own review of the COI. */
  requestCoiReview?: unknown
  /** The certificate governing this job (lib/coi/companyCoi). */
  certificate?: InsuranceCertificate | null
  /** A workers' comp certificate on its own, on the job or the account. */
  workersCompCertificate?: { filename: string | null; uploadedAt: Date | string | null } | null
}

export interface InsuranceItemState {
  /**
   * Is there anything for the CLIENT to upload? That is the only question
   * the portal is entitled to ask them, and it is not the same question as
   * "is this job insured".
   */
  satisfied: boolean
  proof: InsuranceProof | null
  /** One sentence for the client. Empty when there is nothing to add. */
  note: string
  /**
   * Has it actually CLEARED — a person approved it, or every critical check
   * passed on the read?
   *
   * Kept apart from `satisfied` on purpose. A certificate sitting in our
   * review queue is nothing for the client to do (the job portal has said
   * "Reviewing" about exactly that state since 2026-09-12) but it is NOT
   * approved, and a step that closes with the words "Insurance Documents
   * Approved" over an unreviewed certificate is a false all-clear — the
   * failure mode this whole fix must not introduce while removing the
   * double-ask. Surfaces choose their wording from this.
   */
  verified: boolean
}

export interface InsuranceStepState {
  coi: InsuranceItemState
  wc: InsuranceItemState
  /**
   * Nothing left to ask this client for on the insurance step. NOT a claim
   * that the certificate is approved — read `coi.verified` for that.
   */
  complete: boolean
}

/** A stored review arrives as JSON from three different columns. */
function asReview(v: unknown): CoiAiResponse | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as CoiAiResponse) : null
}

function asDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return isNaN(d.getTime()) ? null : d
}

function dayWords(v: Date | string | null | undefined): string {
  const d = asDate(v)
  return d
    ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : ''
}

/**
 * Is a certificate already on file something the client can stop thinking
 * about?
 *
 * REJECTED and COUNTERED are the two states where a NEW document is genuinely
 * owed — the desk has told them so, in those words (lib/coi/coiState's
 * `coiClientDecision`). An expired policy is no longer proof of anything. A
 * certificate still waiting on review counts: handing it over was the
 * client's part, and reviewing it is ours. Asking them to upload it a second
 * time while it sits in our queue is precisely the double-ask this module
 * exists to stop.
 */
export function certificateStands(cert: InsuranceCertificate, now: Date): boolean {
  if (cert.humanDecision === 'REJECTED' || cert.humanDecision === 'COUNTERED') return false
  const expiry = asDate(cert.policyExpiryDate)
  if (expiry && expiry.getTime() < now.getTime()) return false
  return true
}

/** PURE. The whole rule — see the module header for why each branch exists. */
export function insuranceStepState(
  input: InsuranceStepInputs,
  now: Date = new Date(),
): InsuranceStepState {
  const cert = input.certificate && certificateStands(input.certificate, now) ? input.certificate : null

  // ── Certificate of insurance ──────────────────────────────────────
  let coi: InsuranceItemState = { satisfied: false, proof: null, note: '', verified: false }
  if (input.coiReceived) {
    // `coi_received` is written only when every CRITICAL check passed.
    coi = { satisfied: true, proof: 'REQUEST', note: '', verified: true }
  } else if (cert) {
    const when = dayWords(cert.uploadedAt)
    const verified = cert.humanDecision === 'APPROVED' || cert.coverageVerified === true
    // Naming the FILE matters more than it looks: the client is being told
    // not to upload something, and the only way they can check we mean the
    // same document is to see its name back.
    const what =
      cert.source === 'COMPANY'
        ? 'Your account’s certificate of insurance is on file with SirReel and covers this job'
        : `We already have ${cert.filename || 'your certificate of insurance'}${
            when ? `, received ${when}` : ''
          }`
    coi = {
      satisfied: true,
      proof: cert.source,
      verified,
      // Unreviewed is said out loud rather than dressed up as "nothing to
      // upload": it is true, it sets the expectation that we may come back,
      // and it is the same word the job portal uses for this state.
      note: verified
        ? `${what} — there is nothing to upload here.`
        : `${what}. It is with SirReel for review — we will be in touch if anything is missing.`,
    }
  }

  // ── Workers' compensation ─────────────────────────────────────────
  //
  // The request's own review first: it is the certificate THIS portal took,
  // and it is the case that was unreachable before today.
  let wc: InsuranceItemState = { satisfied: false, proof: null, note: '', verified: false }
  const onCoi =
    coiCarriesWorkersComp(asReview(input.requestCoiReview)) ||
    (!!cert && coiCarriesWorkersComp(asReview(cert.aiResponse)))
  if (input.wcReceived) {
    wc = { satisfied: true, proof: 'REQUEST', note: '', verified: true }
  } else if (onCoi) {
    wc = {
      satisfied: true,
      proof: 'ON_COI',
      verified: true,
      note: 'Workers’ compensation is shown on your certificate of insurance — no separate upload needed.',
    }
  } else if (input.workersCompCertificate) {
    const when = dayWords(input.workersCompCertificate.uploadedAt)
    wc = {
      satisfied: true,
      proof: 'JOB',
      verified: true,
      note: `We already have ${
        input.workersCompCertificate.filename || 'your workers’ compensation certificate'
      }${when ? `, received ${when}` : ''}.`,
    }
  }

  return { coi, wc, complete: coi.satisfied && wc.satisfied }
}
