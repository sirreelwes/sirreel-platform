/**
 * Recording a job's LCDW election, and filing the addendum it produces.
 *
 * Wes, 2026-09-01: annual-agreement companies are "automatically approved on
 * the rental agreement and only asked to elect or deny LCDW... a small
 * addendum is added to the RA for that job file with the Job Name inserted
 * into RA and the LCDW election."
 *
 * Two things happen here, in this order and for a reason:
 *
 *   1. The ELECTION is stored. This is the client's answer and the writing
 *      the LCDW addendum requires. It must survive even if step 2 fails.
 *   2. The ADDENDUM PDF is cut and filed against the company's master
 *      agreement, so the job file shows what the client agreed to.
 *
 * Step 2 is best-effort on purpose. A React-PDF render or a Blob hiccup must
 * never lose a client's answer or make the portal show an error over a
 * decision we in fact recorded — `fileJobAddendum` is re-runnable and the
 * staff surface offers a re-cut. The reverse (PDF filed, election lost) is
 * the failure that would actually hurt: an addendum nobody can trace to an
 * answer in the database.
 *
 * What this never does: touch money. LCDW is $24/day/vehicle, and the fee
 * line stays a staff action through /api/orders/[id]/lcdw — the only path
 * that applies the per-line eligibility rule. Same restraint the booking-
 * token portal already keeps. An acceptance here RAISES the flag; a human
 * still prices it.
 */
import { put } from '@vercel/blob'
import type { LcdwDecision, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { findCompanyAnnualCoverage, annualCoverageTitle } from '@/lib/orders/annualCoverage'
import { generateJobAddendumPdf } from '@/lib/contracts/generateJobAddendumPdf'
import { quoteLcdw, type LcdwCandidate } from '@/lib/pricing/lcdwEligibility'
import { deriveOrderWindow } from '@/lib/jobs/dateRange'
import { stapleAgreementPdfs } from '@/lib/contracts/stapleAgreement'
import { readPrivateBlobBuffer } from '@/lib/claims/streamBlob'

/** The exclusion reason, in words a client can act on. Mirrors the phrasing
 *  describeLcdwCoverage uses on the order UI so the addendum and the quote
 *  give the same explanation. */
function ineligibleReason(reason: string | undefined): string {
  return reason === 'partner-vehicle' ? 'partner vehicle' : 'specialty vehicle'
}

/** Orders that are not part of the live picture for a job addendum. */
const DEAD_ORDER_STATUSES = new Set(['CANCELLED', 'CLOSED', 'VOID'])

/**
 * The LCDW answer that actually governs a job.
 *
 * The per-job election wins when there is one; otherwise the standing answer
 * signed on the annual master applies. An annual client checked "I accept
 * LCDW for all fleet vehicle rentals" and signed it — that IS an answer, and
 * re-asking as though it were not would be asking them to re-decide
 * something they committed to for the year.
 *
 * Returns null when neither exists: an account with no annual and no
 * election has genuinely not answered, and "unanswered" must never collapse
 * into "declined" — declining is a liability position somebody has to have
 * actually taken.
 */
export function effectiveLcdwDecision(
  jobElection: { decision: LcdwDecision } | null | undefined,
  standing: LcdwDecision | null | undefined,
): { decision: LcdwDecision; source: 'JOB' | 'ANNUAL' } | null {
  if (jobElection) return { decision: jobElection.decision, source: 'JOB' }
  if (standing) return { decision: standing, source: 'ANNUAL' }
  return null
}

/**
 * What an annual-account client affirms, per job.
 *
 * Wes, 2026-09-02: "the client be required to acknowledge the annual
 * agreement is on file and the status of the LCDW election."
 *
 * Both halves are named, because acknowledging only the agreement leaves the
 * waiver — the part with money and liability on it — as something they were
 * merely not stopped from noticing.
 */
export function annualAcknowledgementText(
  masterTitle: string,
  decision: LcdwDecision,
): string {
  // "the" is not decoration. Without it the stored attestation reads "I
  // confirm that 2026 Annual Rental Agreement is on file" — and this string
  // is kept verbatim as the wording the client signed, so it has to read like
  // a sentence a person would put their name to.
  return (
    `I confirm that the ${masterTitle} is on file with SirReel and in effect for this job, ` +
    `and that our Limited Collision Damage Waiver election for this job is ` +
    `${decision === 'ACCEPTED' ? 'ACCEPTED' : 'DECLINED'}. ` +
    'By typing my name and submitting, I am providing my electronic signature, which has ' +
    'the same legal effect as a handwritten signature under the U.S. ESIGN Act and California UETA.'
  )
}

export const LCDW_ACKNOWLEDGEMENT_TEXT =
  'I confirm the Limited Collision Damage Waiver election above for this job. ' +
  'By typing my name and submitting, I am providing my electronic signature, which has ' +
  'the same legal effect as a handwritten signature under the U.S. ESIGN Act and California UETA.'

export interface RecordElectionInput {
  jobId: string
  decision: LcdwDecision
  /** The client also affirmed the master is on file (annual accounts). */
  acknowledgeAgreementId?: string | null
  signerName: string
  signerTitle?: string | null
  signerEmail?: string | null
  signatureData?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  source?: 'PORTAL_JOB' | 'STAFF'
  recordedById?: string | null
  /** The exact wording the client agreed to. Stored verbatim — a stored
   *  acknowledgement that says something different from what was on screen is
   *  worse than none. */
  acknowledgmentText?: string | null
}

/**
 * What the waiver would cover on this job, resolved from the ORDER lines.
 *
 * Order lines, not booking items: an annual account's job is quoted in HQ,
 * and the line carries the billable days and the catalog code the
 * eligibility rule reads. Bookings are the Planyo-era anchor and half of
 * their items still need the legacy category bridge.
 */
export async function summarizeJobLcdwCoverage(jobId: string) {
  const orders = await prisma.order.findMany({
    where: { jobId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      startDate: true,
      endDate: true,
      booking: { select: { startDate: true, endDate: true, status: true } },
      job: { select: { bookings: { select: { startDate: true, endDate: true, status: true } } } },
      lineItems: {
        select: {
          id: true,
          description: true,
          department: true,
          quantity: true,
          billableDays: true,
          type: true,
          pickupDate: true,
          returnDate: true,
          inventoryItem: { select: { code: true } },
          subRentals: { select: { id: true }, take: 1 },
        },
      },
    },
  })

  const live = orders.filter((o) => !o.status || !DEAD_ORDER_STATUSES.has(o.status))

  const candidates: LcdwCandidate[] = live.flatMap((o) =>
    o.lineItems
      // Fee lines are charges, not vehicles — never judge them.
      .filter((l) => l.type !== 'FEE')
      .map((l) => ({
        id: l.id,
        description: l.description,
        code: l.inventoryItem?.code ?? null,
        department: l.department,
        quantity: l.quantity,
        billableDays: l.billableDays,
        isPartnerVehicle: l.subRentals.length > 0,
      })),
  )

  const quote = quoteLcdw(candidates)

  // The rental period the addendum prints: the widest window across the
  // job's live orders, each derived the honest way (header → lines → hold).
  const windows = live.map((o) => deriveOrderWindow(o))
  const starts = windows.map((w) => w.start).filter((d): d is Date => !!d)
  const ends = windows.map((w) => w.end).filter((d): d is Date => !!d)

  // De-duplicate by description: the addendum is a client-facing list, and
  // "Cube Truck ×3" spread over three lines should read as one entry.
  const uniq = (xs: string[]) => [...new Set(xs)]

  return {
    orders: live,
    orderNumbers: live.map((o) => o.orderNumber),
    coveredVehicles: uniq(quote.eligible.map((v) => v.description)),
    excludedVehicles: quote.excluded
      .filter(
        (v, i, arr) => arr.findIndex((x) => x.description === v.description) === i,
      )
      .map((v) => ({ description: v.description, reason: ineligibleReason(v.reason) })),
    allExcluded: quote.allExcluded,
    hasVehicles: quote.eligible.length + quote.excluded.length > 0,
    rentalStart: starts.length ? new Date(Math.min(...starts.map(Number))) : null,
    rentalEnd: ends.length ? new Date(Math.max(...ends.map(Number))) : null,
  }
}

/**
 * Cut the job addendum PDF and file it on the JobAgreementAddendum row that
 * links this job to the company's master.
 *
 * Idempotent and re-runnable: the addendum row is upserted on its
 * (jobId, companyAgreementId) unique key and the file is REPLACED, because
 * there is one current addendum per job per master — a re-elect supersedes,
 * it does not accumulate. Superseded blobs are left in place (same rule as
 * the standing-agreement upload: clear ≠ retract, and an audit trail that
 * points at a deleted blob is worse than an orphan).
 *
 * Returns the addendum row id, or null when the job has no auto-covering
 * master to attach to — a non-annual client's election is still recorded,
 * it just has no master to be an addendum TO.
 */
export async function fileJobAddendum(jobId: string): Promise<string | null> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      name: true,
      jobCode: true,
      companyId: true,
      company: { select: { name: true } },
      lcdwElection: true,
    },
  })
  if (!job) return null

  const coverage = await findCompanyAnnualCoverage(job.companyId)
  if (!coverage) return null

  // The addendum can be cut from the STANDING election alone — that is the
  // point of an annual account (Wes, 2026-09-02: a job should "only require
  // job name and dates, along with LCDW election to update"). Job name and
  // dates come from the job; the waiver answer is already signed on the
  // master. So a job file gets its addendum the moment it is covered, and a
  // client who changes their mind re-cuts it.
  const election = job.lcdwElection
  const effective = effectiveLcdwDecision(election, coverage.standingLcdwDecision)
  if (!effective) return null

  const summary = await summarizeJobLcdwCoverage(jobId)

  const pdf = await generateJobAddendumPdf({
    companyName: job.company?.name ?? null,
    masterTitle: annualCoverageTitle(coverage),
    masterEffectiveDate: coverage.effectiveDate,
    masterExpiryDate: coverage.expiryDate,
    masterSignerName: coverage.signerName,
    masterSignedAt: coverage.signedAt,
    jobName: job.name,
    jobCode: job.jobCode,
    rentalStart: summary.rentalStart,
    rentalEnd: summary.rentalEnd,
    orderNumbers: summary.orderNumbers,
    decision: effective.decision,
    decisionSource: effective.source,
    standingDecision: coverage.standingLcdwDecision,
    coveredVehicles: summary.coveredVehicles,
    excludedVehicles: summary.excludedVehicles,
    // No per-job election yet: the answer and the signature both come from
    // the master, and the addendum says so rather than inventing a job-level
    // signature nobody gave.
    acknowledgedMaster: !!election?.acknowledgedAgreementId,
    signature: election
      ? {
          signerName: election.signerName || 'Client',
          signerTitle: election.signerTitle,
          signerEmail: election.signerEmail,
          acknowledgmentText: election.acknowledgmentText || LCDW_ACKNOWLEDGEMENT_TEXT,
          decidedAt: election.decidedAt,
          ipAddress: election.ipAddress,
          userAgent: election.userAgent,
        }
      : null,
    masterSignatureNote: election
      ? null
      : `Carried from the ${annualCoverageTitle(coverage)}${coverage.signerName ? `, signed by ${coverage.signerName}` : ''}${coverage.signedAt ? ` on ${coverage.signedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}` : ''}.`,
    generatedAt: new Date(),
  })

  const safeCode = (job.jobCode || job.id).replace(/[^A-Za-z0-9._-]+/g, '-')
  const blobKey = `job-addenda/${jobId}/${safeCode}-lcdw-addendum-${Date.now()}.pdf`
  // PRIVATE store — a signed client document, same as every other agreement
  // blob. Served to staff through /api/agreements/addendum/[id].
  const uploaded = await put(blobKey, pdf, {
    access: 'private' as 'public',
    contentType: 'application/pdf',
  })

  const filename = `${safeCode}-LCDW-addendum.pdf`
  const note = election
    ? `LCDW ${effective.decision === 'ACCEPTED' ? 'accepted' : 'declined'} by ${election.signerName || 'client'}`
    : `LCDW ${effective.decision === 'ACCEPTED' ? 'accepted' : 'declined'} — carried from the annual agreement`

  // ── Staple: the master and this addendum as ONE document ─────────
  //
  // Wes, 2026-09-02. Derived and best-effort: the master is the contract and
  // the addendum is the amendment, and both keep their own stored copies. A
  // master that cannot be parsed (an odd scan, an encrypted export) must not
  // take the addendum down with it — losing the convenience copy costs a
  // second attachment, losing the addendum costs the record of what the
  // client elected.
  let combined: { key: string; url: string; filename: string; size: number } | null = null
  try {
    const master = await prisma.companyAgreement.findUnique({
      where: { id: coverage.companyAgreementId },
      select: { fileUrl: true },
    })
    const masterBytes = master?.fileUrl ? await readPrivateBlobBuffer(master.fileUrl) : null
    if (masterBytes) {
      const stapled = await stapleAgreementPdfs(masterBytes, pdf)
      const combinedName = `${safeCode}-rental-agreement.pdf`
      const combinedKey = `job-agreements/${jobId}/${safeCode}-agreement-${Date.now()}.pdf`
      const up = await put(combinedKey, stapled.bytes, {
        access: 'private' as 'public',
        contentType: 'application/pdf',
      })
      combined = {
        key: combinedKey,
        url: up.url,
        filename: combinedName,
        size: stapled.bytes.length,
      }
    }
  } catch (err) {
    console.error('[lcdw] staple failed (addendum IS filed):', jobId, err)
  }

  const combinedFields = combined
    ? {
        combinedFileKey: combined.key,
        combinedFileUrl: combined.url,
        combinedFilename: combined.filename,
        combinedFileSize: combined.size,
        combinedAt: new Date(),
      }
    : {}

  const row = await prisma.jobAgreementAddendum.upsert({
    where: {
      jobId_companyAgreementId: { jobId, companyAgreementId: coverage.companyAgreementId },
    },
    create: {
      jobId,
      companyAgreementId: coverage.companyAgreementId,
      addendumFileKey: blobKey,
      addendumFileUrl: uploaded.url,
      addendumFilename: filename,
      addendumFileSize: pdf.length,
      note,
      addedById: election?.recordedById ?? null,
      ...combinedFields,
    },
    update: {
      addendumFileKey: blobKey,
      addendumFileUrl: uploaded.url,
      addendumFilename: filename,
      addendumFileSize: pdf.length,
      note,
      // A previously soft-deleted link is revived by a fresh election — the
      // job IS covered again, and leaving deletedAt set would hide the
      // current addendum behind a stale removal.
      deletedAt: null,
      ...combinedFields,
    },
    select: { id: true },
  })

  return row.id
}

/**
 * Record (or change) the job's LCDW election, then file the addendum.
 *
 * Returns the election plus whether an addendum was filed, so the caller can
 * tell the client "we've added this to your file" only when it is true.
 */
export async function recordJobLcdwElection(input: RecordElectionInput) {
  const {
    jobId, decision, signerName, signerTitle, signerEmail, signatureData,
    ipAddress, userAgent, source = 'PORTAL_JOB', recordedById,
    acknowledgeAgreementId,
  } = input

  const prior = await prisma.lcdwElection.findUnique({
    where: { jobId },
    select: { decision: true, decidedAt: true, signerName: true },
  })

  const data: Prisma.LcdwElectionUncheckedCreateInput = {
    jobId,
    decision,
    decidedAt: new Date(),
    signerName,
    signerTitle: signerTitle ?? null,
    signerEmail: signerEmail ?? null,
    signatureData: signatureData ?? null,
    acknowledgmentText: input.acknowledgmentText || LCDW_ACKNOWLEDGEMENT_TEXT,
    acknowledgedAgreementId: acknowledgeAgreementId ?? null,
    acknowledgedAt: acknowledgeAgreementId ? new Date() : null,
    ipAddress: ipAddress ?? null,
    userAgent: userAgent ?? null,
    source,
    recordedById: recordedById ?? null,
  }

  const election = await prisma.lcdwElection.upsert({
    where: { jobId },
    create: data,
    update: data,
  })

  // The superseded answer lives here, not in the elections table — one row
  // per job is what makes "what did they choose?" answerable without a
  // tie-break, and the history belongs in the audit trail either way.
  await prisma.auditLog
    .create({
      data: {
        action: prior ? 'job.lcdw_election_changed' : 'job.lcdw_election_recorded',
        entityType: 'Job',
        entityId: jobId,
        userId: recordedById ?? null,
        ipAddress: ipAddress ?? null,
        oldValues: prior
          ? {
              decision: prior.decision,
              decidedAt: prior.decidedAt.toISOString(),
              signerName: prior.signerName,
            }
          : undefined,
        newValues: { decision, source, signerName },
      },
    })
    .catch((err) => console.error('[lcdw] audit write failed', jobId, err))

  let addendumId: string | null = null
  try {
    addendumId = await fileJobAddendum(jobId)
  } catch (err) {
    // Never fail the client's submission over a PDF. The election is stored;
    // staff can re-cut the addendum from the job page.
    console.error('[lcdw] addendum render/file failed (election IS recorded):', jobId, err)
  }

  return { election, addendumId }
}
