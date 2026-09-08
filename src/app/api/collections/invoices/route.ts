import type { InvoiceStatus } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/collections/invoices?q= — search HQ's own invoices.
 *
 * Ana, 2026-09-09: "is it possible for me to get a search bar for all
 * invoices? I have a search bar for RentalWorks but will need to be able to
 * access the HQ ones going forward."
 *
 * The RentalWorks mirror has had a search since collections shipped; the
 * native invoices had none anywhere in HQ. They were reachable only by
 * walking to the job that owns them — fine while HQ invoices were a handful,
 * useless the moment billing actually moves here, which is what the To bill
 * queue just started doing.
 *
 * Deliberately the SAME shape as /api/collections/rw-invoices, because the
 * two sit side by side on one page and Ana should not have to learn two
 * search boxes:
 *
 *   blank query  what is collectible — invoices with a balance still owed,
 *                oldest debt first, because that is the worklist
 *   a query      EVERYTHING matching, newest first, including paid and
 *                voided ones, each carrying its status
 *
 * That asymmetry is on purpose in both routes. Someone typing an invoice
 * number is answering "what happened with this one" and must find it whether
 * or not it is still owed; a blank box is asking "what needs chasing".
 *
 * Searches the numbers and names a person actually has in front of them: the
 * invoice number, the order number, the client, and the job (name or code).
 */

const TAKE = 50

/** What counts as owed on an HQ invoice. DRAFT is deliberately absent — see
 *  the where-clause below. */
const OWED_STATUSES: InvoiceStatus[] = ['SENT', 'PARTIAL']

export async function GET(req: NextRequest) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 80)
  const like = { contains: q, mode: 'insensitive' as const }

  const where = q
    ? {
        OR: [
          { invoiceNumber: like },
          { order: { orderNumber: like } },
          { order: { company: { name: like } } },
          { order: { job: { name: like } } },
          { order: { job: { jobCode: like } } },
        ],
      }
    : {
        // The collectible definition for HQ invoices. A DRAFT invoice is
        // deliberately NOT here: it has never gone to the client, so it is
        // not money owed — it is work still on the To bill queue, and
        // listing it as a receivable would double-count it against that
        // panel directly above.
        status: { in: OWED_STATUSES },
        balanceDue: { gt: 0 },
      }

  const invoices = await prisma.invoice.findMany({
    where,
    // Blank list is a worklist — oldest debt first, matching the RW list's
    // sort so the two read alike. A search wants recency.
    orderBy: q
      ? [{ createdAt: 'desc' as const }]
      : [{ dueDate: { sort: 'asc' as const, nulls: 'last' as const } }, { createdAt: 'asc' as const }],
    take: TAKE,
    select: {
      id: true,
      invoiceNumber: true,
      type: true,
      status: true,
      total: true,
      amountPaid: true,
      balanceDue: true,
      dueDate: true,
      sentAt: true,
      paidAt: true,
      pdfBlobKey: true,
      createdAt: true,
      // The pre-invoice round — a SENT-for-review invoice is not a bill, and
      // a row that cannot say so reads like an unpaid one.
      preSentAt: true,
      clientApprovedAt: true,
      clientChangeRequestedAt: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          company: { select: { name: true } },
          job: { select: { id: true, name: true, jobCode: true } },
        },
      },
    },
  })

  // Whether the result set was cut off. The RW list has the same cap and the
  // same reason for saying so: a truncated list that gives no sign it was
  // truncated is how the /jobs list quietly lost 50 rows.
  const total = await prisma.invoice.count({ where })

  return NextResponse.json({
    ok: true,
    query: q,
    total,
    truncated: total > invoices.length,
    invoices: invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      type: i.type,
      status: i.status,
      total: Number(i.total),
      amountPaid: Number(i.amountPaid),
      balanceDue: Number(i.balanceDue),
      dueDate: i.dueDate ? i.dueDate.toISOString().slice(0, 10) : null,
      sentAt: i.sentAt?.toISOString() ?? null,
      paidAt: i.paidAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
      // No blob key means no document to open — the row must not offer a PDF
      // link that 404s.
      hasPdf: !!i.pdfBlobKey,
      preSentAt: i.preSentAt?.toISOString() ?? null,
      clientApprovedAt: i.clientApprovedAt?.toISOString() ?? null,
      clientChangeRequestedAt: i.clientChangeRequestedAt?.toISOString() ?? null,
      orderId: i.order.id,
      orderNumber: i.order.orderNumber,
      companyName: i.order.company?.name ?? null,
      jobId: i.order.job?.id ?? null,
      jobName: i.order.job?.name ?? null,
      jobCode: i.order.job?.jobCode ?? null,
    })),
  })
}
