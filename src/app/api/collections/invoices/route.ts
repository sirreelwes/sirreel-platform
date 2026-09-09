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
 *   blank query  the chosen scope — see below — as a browsable list
 *   a query      EVERYTHING matching, newest first, including paid and
 *                voided ones, each carrying its status
 *
 * That asymmetry is on purpose in both routes. Someone typing an invoice
 * number is answering "what happened with this one" and must find it whether
 * or not it is still owed; a blank box is asking to browse.
 *
 * `scope` governs the BLANK list only, and is ignored when a query is
 * present for exactly the reason above — narrowing a search by scope is how
 * a number someone typed comes back "not found" because it was paid.
 *
 *   owed (default)  invoices with a balance still owed, oldest debt first,
 *                   because that is the collections worklist
 *   paid            settled invoices, most recently paid first
 *   all             everything, newest first
 *
 * Ana, 2026-09-09: "is there a way to access paid invoices? Right now the
 * path is likely roundabout." It was: a paid invoice was reachable only by
 * typing something that matched it, so answering "did they ever pay us for
 * that job in June" meant already knowing the answer's invoice number.
 *
 * Searches the numbers and names a person actually has in front of them: the
 * invoice number, the order number, the client, and the job (name or code).
 */

const TAKE = 50

type Scope = 'owed' | 'paid' | 'all'

function parseScope(raw: string | null): Scope {
  return raw === 'paid' || raw === 'all' ? raw : 'owed'
}

/** What counts as owed on an HQ invoice. DRAFT is deliberately absent — see
 *  the where-clause below. */
const OWED_STATUSES: InvoiceStatus[] = ['SENT', 'PARTIAL']

export async function GET(req: NextRequest) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 80)
  const scope = parseScope(req.nextUrl.searchParams.get('scope'))
  const like = { contains: q, mode: 'insensitive' as const }

  // The collectible definition for HQ invoices. A DRAFT invoice is
  // deliberately NOT in the owed set: it has never gone to the client, so
  // it is not money owed — it is work still on the To bill queue, and
  // listing it as a receivable would double-count it against that panel
  // directly above.
  //
  // Settled is "the money arrived", not "the row says PAID": a VOID
  // invoice also carries no balance, and offering a cancelled obligation
  // in a list headed Paid is the same class of mistake the RW mirror made
  // with voided balances. So: PAID status, or nothing left to collect on
  // an invoice that actually took money.
  const scopeWhere =
    scope === 'paid'
      ? {
          OR: [
            { status: 'PAID' as const },
            { AND: [{ amountPaid: { gt: 0 } }, { balanceDue: { lte: 0 } }, { NOT: { status: 'VOID' as const } }] },
          ],
        }
      : scope === 'all'
        ? {}
        : { status: { in: OWED_STATUSES }, balanceDue: { gt: 0 } }

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
    : scopeWhere

  const invoices = await prisma.invoice.findMany({
    where,
    // The owed list is a worklist — oldest debt first, matching the RW
    // list's sort so the two read alike. A search wants recency, and so
    // does a browse: "what came in lately" is the question a Paid list is
    // asked, which is why it sorts on when the money landed rather than
    // on when the invoice was cut.
    orderBy: q
      ? [{ createdAt: 'desc' as const }]
      : scope === 'paid'
        ? [{ paidAt: { sort: 'desc' as const, nulls: 'last' as const } }, { createdAt: 'desc' as const }]
        : scope === 'all'
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
    // Echoed so the client can say what it is showing. A search ignores
    // scope (see the header), and a UI that still highlighted "Paid" over
    // a list of everything would be lying about its own filter.
    scope: q ? 'all' : scope,
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
