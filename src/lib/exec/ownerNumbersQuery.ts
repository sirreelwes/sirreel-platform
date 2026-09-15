import { prisma } from '@/lib/prisma'
import { collectibleWhere, nonCollectibleInvoiceIds } from '@/lib/collections/collectible'
import { pacificDayRange } from '@/lib/collections/eodReport'
import { earliestNeeded, summarizeOwnerNumbers, type OwnerNumbers } from './ownerNumbers'
import { pacificDayKey } from './periods'

/**
 * The Prisma half of the owner numbers page. Reads rows and hands them to
 * summarizeOwnerNumbers(), where every definition lives.
 *
 * One pass per request, no cache: the page is opened a few times a day by one
 * person, and the heaviest read — 13 months of RW invoices — is ~4,500 rows.
 */

const n = (v: unknown): number => Number(v ?? 0)

export async function buildOwnerNumbers(now: Date = new Date()): Promise<OwnerNumbers> {
  const today = pacificDayKey(now)
  const { instant, invoiceMonth } = earliestNeeded(today)
  const since = pacificDayRange(instant).start
  const invoicesSince = new Date(`${invoiceMonth}-01T00:00:00Z`)

  const [
    orders,
    rwInvoices,
    hqInvoices,
    paidObservations,
    trackingAgg,
    payments,
    excludedIds,
    openQuotes,
    wonNotBooked,
    rwSync,
  ] = await Promise.all([
    prisma.order.findMany({
      where: {
        archivedAt: null,
        OR: [{ createdAt: { gte: since } }, { quoteSentAt: { gte: since } }, { wonAt: { gte: since } }],
      },
      select: {
        createdAt: true, quoteSentAt: true, wonAt: true, status: true,
        total: true, bookedTotal: true,
        agent: { select: { name: true } },
      },
    }),
    prisma.rwInvoice.findMany({
      where: { invoiceDate: { gte: invoicesSince } },
      select: { invoiceDate: true, status: true, invoiceTotal: true, receivedTotal: true },
    }),
    // All of them: few, and open balances need every unpaid one regardless of age.
    prisma.invoice.findMany({
      where: { status: { notIn: ['DRAFT', 'VOID'] } },
      select: {
        sentAt: true, createdAt: true, status: true, total: true, amountPaid: true, balanceDue: true,
        order: { select: { company: { select: { name: true } } } },
      },
    }),
    prisma.rwInvoicePaidObservation.findMany({
      where: { observedPaidAt: { gte: since }, preTracking: false },
      select: { observedPaidAt: true, invoiceTotal: true },
    }),
    prisma.rwInvoicePaidObservation.aggregate({
      where: { preTracking: false },
      _min: { observedPaidAt: true },
    }),
    prisma.payment.findMany({
      where: { receivedAt: { gte: since }, status: 'CLEARED', voidedAt: null },
      select: { receivedAt: true, amount: true },
    }),
    nonCollectibleInvoiceIds(),
    prisma.order.aggregate({
      where: { archivedAt: null, status: 'QUOTE_SENT' },
      _count: true,
      _sum: { total: true },
    }),
    prisma.order.aggregate({
      where: { archivedAt: null, status: 'APPROVED' },
      _count: true,
      _sum: { total: true },
    }),
    prisma.rwInvoice.aggregate({ _max: { syncedAt: true }, _min: { invoiceDate: true } }),
  ])

  const openRw = await prisma.rwInvoice.findMany({
    where: collectibleWhere(excludedIds),
    select: { invoiceDate: true, remainingTotal: true, customerName: true },
  })

  return summarizeOwnerNumbers(
    {
      orders: orders.map((o) => ({
        createdAt: o.createdAt,
        quoteSentAt: o.quoteSentAt,
        wonAt: o.wonAt,
        status: String(o.status),
        total: n(o.total),
        bookedTotal: o.bookedTotal === null ? null : n(o.bookedTotal),
        agentName: o.agent?.name ?? 'Unassigned',
      })),
      rwInvoices: rwInvoices.map((r) => ({
        invoiceDate: r.invoiceDate,
        status: r.status,
        invoiceTotal: n(r.invoiceTotal),
        receivedTotal: n(r.receivedTotal),
      })),
      hqInvoices: hqInvoices.map((i) => ({
        sentAt: i.sentAt,
        createdAt: i.createdAt,
        status: String(i.status),
        total: n(i.total),
        amountPaid: n(i.amountPaid),
        balanceDue: n(i.balanceDue),
        customerName: i.order?.company?.name ?? '',
      })),
      paidObservations: paidObservations.map((o) => ({
        observedPaidAt: o.observedPaidAt,
        invoiceTotal: n(o.invoiceTotal),
      })),
      trackingSince: trackingAgg._min.observedPaidAt,
      payments: payments.map((p) => ({ receivedAt: p.receivedAt, amount: n(p.amount) })),
      openRw: openRw.map((r) => ({
        invoiceDate: r.invoiceDate,
        remainingTotal: n(r.remainingTotal),
        customerName: r.customerName,
      })),
      pipeline: {
        openQuotes: { count: openQuotes._count, value: n(openQuotes._sum.total) },
        wonNotBooked: { count: wonNotBooked._count, value: n(wonNotBooked._sum.total) },
      },
      rwSyncedAt: rwSync._max.syncedAt,
      rwEarliestInvoice: rwSync._min.invoiceDate,
    },
    today,
  )
}
