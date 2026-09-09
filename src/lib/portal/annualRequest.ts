/**
 * "We'd like to set up an annual agreement" — the client's ask, captured.
 *
 * ── Why a request and not a self-serve signature ───────────────────────
 * An annual master is an ACCOUNT-level commitment: it papers every show
 * for the year and carries a standing LCDW election. The person sitting on
 * a job's paperwork page is usually a coordinator, not the executive who
 * can bind the company — so the portal takes the ask, and staff answer it
 * with the existing "Offer annual agreement" button, which files the
 * pending master an executive then signs in the account portal
 * (src/lib/portal/companyAnnual.ts). Nothing here grants coverage, and
 * nothing here writes to CompanyAgreement.
 *
 * ── One open ask per account ───────────────────────────────────────────
 * `recordAnnualRequest` is idempotent while one is open: two coordinators
 * on two shows for the same client produce ONE queue row, not two. The
 * second ask still returns the open row, so both portals can honestly say
 * "your rep has this".
 *
 * ── The ask never outlives its answer ──────────────────────────────────
 * `listOpenAnnualRequests` drops any company that already carries a
 * pending or covering master, on top of the resolvedAt stamp. Stamping is
 * best-effort bookkeeping; the derived filter is what guarantees the queue
 * cannot ask an agent to offer an annual that is already sitting in the
 * client's portal awaiting signature.
 */

import { prisma } from '@/lib/prisma'
import { isCoverageCurrent } from '@/lib/orders/annualCoverage'

export interface AnnualRequestRow {
  id: string
  companyId: string
  companyName: string
  jobId: string | null
  jobCode: string | null
  jobName: string | null
  requestedByName: string | null
  requestedByEmail: string | null
  source: string
  createdAt: Date
  /** The agent who owns the account, for the queue's "assigned to" line. */
  agentName: string | null
}

/** The open ask for this account, if any. */
export async function findOpenAnnualRequest(companyId: string): Promise<{
  id: string
  createdAt: Date
  requestedByName: string | null
  source: string
} | null> {
  return prisma.companyAnnualRequest.findFirst({
    where: { companyId, resolvedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true, requestedByName: true, source: true },
  })
}

/**
 * Record the ask. Returns the open request — the existing one when the
 * account already has one, so a second click (or a second show) never
 * stacks a duplicate for the desk to reconcile.
 */
export async function recordAnnualRequest(args: {
  companyId: string
  jobId?: string | null
  personId?: string | null
  name?: string | null
  email?: string | null
  source: 'JOB_PORTAL' | 'ACCOUNT_PORTAL'
}): Promise<{ id: string; createdAt: Date; alreadyOpen: boolean }> {
  const open = await findOpenAnnualRequest(args.companyId)
  if (open) return { id: open.id, createdAt: open.createdAt, alreadyOpen: true }

  const row = await prisma.companyAnnualRequest.create({
    data: {
      companyId: args.companyId,
      jobId: args.jobId ?? null,
      requestedByPersonId: args.personId ?? null,
      requestedByName: args.name?.trim() || null,
      requestedByEmail: args.email?.trim().toLowerCase() || null,
      source: args.source,
    },
    select: { id: true, createdAt: true },
  })
  return { ...row, alreadyOpen: false }
}

/**
 * Close every open ask on an account. Called when staff file the annual
 * for signature — the ask has been answered at that point, whether or not
 * the executive gets around to signing.
 */
export async function resolveAnnualRequests(args: {
  companyId: string
  reason: string
  byUserId?: string | null
}): Promise<number> {
  const res = await prisma.companyAnnualRequest.updateMany({
    where: { companyId: args.companyId, resolvedAt: null },
    data: {
      resolvedAt: new Date(),
      resolvedReason: args.reason,
      resolvedById: args.byUserId ?? null,
    },
  })
  return res.count
}

/**
 * Open asks, minus the ones the account has already outgrown.
 *
 * A company that now carries a pending master (offered, awaiting the
 * executive's signature) or a live covering one is filtered out even if
 * its row was never stamped — see the header note.
 */
export async function listOpenAnnualRequests(): Promise<AnnualRequestRow[]> {
  const rows = await prisma.companyAnnualRequest.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      companyId: true,
      jobId: true,
      requestedByName: true,
      requestedByEmail: true,
      source: true,
      createdAt: true,
      company: {
        select: {
          name: true,
          defaultAgent: { select: { name: true } },
          agreements: {
            where: { deletedAt: null, isAnnual: true },
            select: {
              pendingSignature: true,
              autoCoverJobs: true,
              deletedAt: true,
              effectiveDate: true,
              expiryDate: true,
            },
          },
        },
      },
      job: { select: { jobCode: true, name: true, agent: { select: { name: true } } } },
    },
  })

  const now = new Date()
  return rows
    .filter(
      (r) =>
        // An EXPIRED master deliberately does NOT suppress the ask — a
        // client asking to renew is asking for something real.
        !r.company.agreements.some((a) => a.pendingSignature || isCoverageCurrent(a, now)),
    )
    .map((r) => ({
      id: r.id,
      companyId: r.companyId,
      companyName: r.company.name,
      jobId: r.jobId,
      jobCode: r.job?.jobCode ?? null,
      jobName: r.job?.name ?? null,
      requestedByName: r.requestedByName,
      requestedByEmail: r.requestedByEmail,
      source: r.source,
      createdAt: r.createdAt,
      agentName: r.job?.agent?.name ?? r.company.defaultAgent?.name ?? null,
    }))
}
