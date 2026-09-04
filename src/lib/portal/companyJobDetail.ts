/**
 * One show, as an executive needs to see it.
 *
 * Wes 2026-09-04: "when clicked, Final invoices, Rental Agreements. Etc."
 *
 * That list is the whole scope, and the omissions are deliberate. There
 * are no line items, no rates, no pick lists, no delivery windows — those
 * live on the job portal the coordinator already has, and duplicating them
 * here would mean two surfaces that can disagree about the same show. What
 * this adds over the tile is the PAPER: what was billed, what was paid,
 * what was signed and by whom.
 *
 * ── The company check is not optional ──────────────────────────────────
 * `companyId` is a required argument, not a convenience: the job is loaded
 * by id AND company, so a valid session for company A cannot fetch a job
 * belonging to company B by guessing its id. Every caller passes the
 * companyId from the resolved SESSION, never from the URL.
 */

import type { InvoiceStatus, JobRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { deriveJobDateRange } from '@/lib/jobs/dateRange'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'
import { pickPrimaryContact } from '@/lib/jobs/primaryContact'
import { findCompanyAnnualCoverage } from '@/lib/orders/annualCoverage'

/** Statuses a client may see. DRAFT is visible only once sent for review. */
const VISIBLE_INVOICE_STATUSES: InvoiceStatus[] = ['SENT', 'PARTIAL', 'PAID']

const SIGNED_STATUSES = ['SIGNED_BASELINE', 'SIGNED_NEGOTIATED', 'SIGNED_OFFLINE'] as const

export interface PortalInvoiceRow {
  id: string
  invoiceNumber: string
  type: string
  status: InvoiceStatus
  /** True while this is a pre-invoice out for the client's review. */
  isPreInvoice: boolean
  total: number
  amountPaid: number
  balanceDue: number
  dueDate: Date | null
  sentAt: Date | null
  paidAt: Date | null
  orderNumber: string
  hasPdf: boolean
}

export interface PortalAgreementRow {
  id: string
  orderNumber: string
  contractType: string
  status: string
  signerName: string | null
  signerTitle: string | null
  signedAt: Date | null
  /** Signed by SOMEONE — includes sibling and annual coverage. */
  isSigned: boolean
  /**
   * How it came to be signed, in words the reader can act on. Coverage is
   * not a signature on THIS order and the copy must never imply it is.
   */
  coverageNote: string | null
  hasPdf: boolean
}

export interface CompanyJobDetail {
  id: string
  jobCode: string
  name: string
  startDate: Date | null
  endDate: Date | null
  returnedAt: Date | null
  jobStatus: string
  repName: string | null
  repEmail: string | null
  contacts: {
    name: string
    role: JobRole
    email: string | null
    phone: string | null
    isPrimary: boolean
    isLead: boolean
  }[]
  invoices: PortalInvoiceRow[]
  agreements: PortalAgreementRow[]
  totals: { invoiced: number; paid: number; balance: number }
}

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export async function buildCompanyJobDetail(
  companyId: string,
  jobId: string,
): Promise<CompanyJobDetail | null> {
  const job = await prisma.job.findFirst({
    // Scoped by company — see the header note. Never findUnique on id alone.
    where: { id: jobId, companyId },
    select: {
      id: true,
      jobCode: true,
      name: true,
      status: true,
      returnedAt: true,
      company: { select: { name: true } },
      agent: { select: { name: true, email: true } },
      jobContacts: {
        select: {
          role: true,
          isPrimary: true,
          person: { select: { firstName: true, lastName: true, email: true, phone: true, mobile: true } },
        },
      },
      bookings: { select: { startDate: true, endDate: true, status: true, jobName: true } },
      orders: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          startDate: true,
          endDate: true,
          invoices: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              invoiceNumber: true,
              type: true,
              status: true,
              preSentAt: true,
              total: true,
              amountPaid: true,
              balanceDue: true,
              dueDate: true,
              sentAt: true,
              paidAt: true,
              pdfBlobKey: true,
            },
          },
          signedAgreements: {
            select: {
              id: true,
              contractType: true,
              status: true,
              signerName: true,
              signerTitle: true,
              signedAt: true,
              signedDocumentUrl: true,
              coveredByAgreementId: true,
              coveredByCompanyAgreementId: true,
            },
          },
        },
      },
    },
  })
  if (!job) return null

  const annual = await findCompanyAnnualCoverage(companyId)
  const range = deriveJobDateRange(job.orders, job.bookings)
  const lead = pickPrimaryContact(job.jobContacts)

  const invoices: PortalInvoiceRow[] = []
  const agreements: PortalAgreementRow[] = []
  let invoiced = 0
  let paid = 0
  let balance = 0

  for (const order of job.orders) {
    for (const inv of order.invoices) {
      const isPre = inv.status === 'DRAFT' && inv.preSentAt != null
      if (!VISIBLE_INVOICE_STATUSES.includes(inv.status) && !isPre) continue
      if (!isPre) {
        invoiced += toNum(inv.total)
        paid += toNum(inv.amountPaid)
        balance += toNum(inv.balanceDue)
      }
      invoices.push({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        type: inv.type,
        status: inv.status,
        isPreInvoice: isPre,
        total: toNum(inv.total),
        amountPaid: toNum(inv.amountPaid),
        balanceDue: toNum(inv.balanceDue),
        dueDate: inv.dueDate,
        sentAt: inv.sentAt,
        paidAt: inv.paidAt,
        orderNumber: order.orderNumber,
        // A pre-invoice renders live rather than from a stored blob, so
        // it is always readable even with no PDF on the row.
        hasPdf: isPre || inv.pdfBlobKey != null,
      })
    }

    for (const a of order.signedAgreements) {
      const directlySigned = (SIGNED_STATUSES as readonly string[]).includes(a.status)
      let coverageNote: string | null = null
      if (!directlySigned && a.coveredByCompanyAgreementId) {
        coverageNote = annual
          ? `Covered by your annual agreement${annual.title ? ` (${annual.title})` : ''}`
          : 'Covered by your annual agreement'
      } else if (!directlySigned && a.coveredByAgreementId) {
        coverageNote = 'Covered by the agreement already signed on this job'
      }
      agreements.push({
        id: a.id,
        orderNumber: order.orderNumber,
        contractType: a.contractType,
        status: a.status,
        signerName: a.signerName,
        signerTitle: a.signerTitle,
        signedAt: a.signedAt,
        isSigned: directlySigned || coverageNote != null,
        coverageNote,
        // Only a real signature has a countersigned copy to read; a
        // covered row has no document of its own, and offering a link
        // to one would be a link to someone else's paperwork.
        hasPdf: directlySigned && a.signedDocumentUrl != null,
      })
    }
  }

  // Newest paperwork first — an executive opening a wrapped show wants
  // the final invoice, not the deposit from three months ago.
  invoices.sort((a, b) => {
    const at = (a.sentAt ?? a.dueDate)?.getTime() ?? 0
    const bt = (b.sentAt ?? b.dueDate)?.getTime() ?? 0
    return bt - at
  })

  return {
    id: job.id,
    jobCode: job.jobCode,
    name: resolveDisplayJobName({
      jobName: job.name,
      bookingJobName: job.bookings[0]?.jobName ?? null,
      companyName: job.company?.name ?? null,
    }),
    startDate: range.start,
    endDate: range.end,
    returnedAt: job.returnedAt,
    jobStatus: job.status,
    repName: job.agent?.name ?? null,
    repEmail: job.agent?.email ?? null,
    contacts: job.jobContacts.map((c) => ({
      name: `${c.person.firstName} ${c.person.lastName}`.trim(),
      role: c.role,
      email: c.person.email,
      phone: c.person.phone || c.person.mobile,
      isPrimary: c.isPrimary,
      isLead:
        lead != null &&
        lead.person.email === c.person.email &&
        lead.role === c.role,
    })),
    invoices,
    agreements,
    totals: { invoiced, paid, balance },
  }
}
