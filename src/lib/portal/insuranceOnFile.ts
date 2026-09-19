/**
 * What insurance is on file for the booking behind a paperwork request — the
 * DB half of the rule in insuranceRules.ts (read that file first; it carries
 * the reasoning and the client complaint this came from).
 *
 * Certificates are read from the JOB and the ACCOUNT alike, because the
 * client does not know which of the two a given upload landed on: the job
 * portal files against the job, the account portal against the company, the
 * drop link against whichever the token named — and from their side all three
 * were the same act of sending us their certificate.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { coiDocumentKind } from '@/lib/coi/coverageKind'
import { COI_SELECT, resolveJobCoi } from '@/lib/coi/companyCoi'
import {
  certificateStands,
  insuranceStepState,
  type InsuranceCertificate,
  type InsuranceStepState,
} from '@/lib/portal/insuranceRules'

export * from '@/lib/portal/insuranceRules'

type Db = PrismaClient | Prisma.TransactionClient

/** How many of a job's / account's newest certificates the resolver reads. */
const CERT_TAKE = 25

export async function resolveInsuranceOnFile(
  input: {
    coiReceived: boolean
    wcReceived: boolean
    requestCoiReview?: unknown
    jobId: string | null
    companyId: string | null
  },
  db: Db = defaultPrisma,
  now: Date = new Date(),
): Promise<InsuranceStepState> {
  const base = {
    coiReceived: input.coiReceived,
    wcReceived: input.wcReceived,
    requestCoiReview: input.requestCoiReview,
  }
  // Nothing a query could add.
  if (!input.jobId && !input.companyId) return insuranceStepState(base, now)

  const scope: Prisma.CoiCheckWhereInput[] = []
  if (input.jobId) scope.push({ jobId: input.jobId })
  if (input.companyId) scope.push({ companyId: input.companyId })

  const [governing, certs] = await Promise.all([
    // Client-facing, so never `includeAwaitingReview`: an account certificate
    // nobody has signed off does not carry forward to this job.
    input.jobId ? resolveJobCoi(input.jobId, db) : Promise.resolve(null),
    db.coiCheck.findMany({
      where: { deletedAt: null, OR: scope },
      orderBy: { createdAt: 'desc' },
      take: CERT_TAKE,
      select: { ...COI_SELECT, aiResponse: true },
    }),
  ])

  const certificate: InsuranceCertificate | null = governing
    ? {
        source: governing.source,
        filename: governing.coi.originalFilename ?? null,
        uploadedAt: governing.coi.createdAt ?? null,
        humanDecision: governing.coi.humanDecision,
        policyExpiryDate: governing.coi.policyExpiryDate ?? null,
        coverageVerified: governing.coi.coverageVerified,
        // resolveJobCoi strips the review before returning; pick it back up
        // from the rows we just read, so the workers'-comp question can be
        // answered off the certificate that actually governs this job.
        aiResponse: certs.find((c) => c.id === governing.coi.id)?.aiResponse ?? null,
      }
    : null

  // Workers' comp on its own paper — a payroll company's certificate, filed
  // on the job or on the account. Same standing test as the COI: a refused or
  // lapsed one is not proof.
  const wcRow =
    certs.find(
      (c) =>
        coiDocumentKind(c.aiResponse) === 'WORKERS_COMP' &&
        certificateStands(
          {
            source: 'JOB',
            filename: c.originalFilename,
            uploadedAt: c.createdAt,
            humanDecision: c.humanDecision,
            policyExpiryDate: c.policyExpiryDate,
          },
          now,
        ),
    ) ?? null

  return insuranceStepState(
    {
      ...base,
      certificate,
      workersCompCertificate: wcRow
        ? { filename: wcRow.originalFilename, uploadedAt: wcRow.createdAt }
        : null,
    },
    now,
  )
}
