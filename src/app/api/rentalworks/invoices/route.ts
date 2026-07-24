import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { OPEN_WHERE, RW_VOID, RW_PAID, getHqPaidInvoiceIds } from '@/lib/rentalworks/arStatus'

export const dynamic = 'force-dynamic'

/**
 * GET /api/rentalworks/invoices — browse the RentalWorks invoice mirror.
 *
 * Serves both the RW invoices page and Ana's Collections dashboard. Reads
 * the HQ mirror, never RW live: RW can't filter invoice/browse at all, and
 * live-fetching is why the legacy dashboards silently show $0 when the token
 * expires. Totals are computed across the whole filtered set, not the page.
 *
 * ?q=        invoice #, order #, or customer (case-insensitive)
 * ?filter=   open | overdue | paid | all      (default: open)
 * ?limit= &offset=
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') || '').trim()
  const filter = (sp.get('filter') || 'open').toLowerCase()
  const limit = Math.min(Math.max(Number(sp.get('limit') || 100), 1), 500)
  const offset = Math.max(Number(sp.get('offset') || 0), 0)

  const where: Prisma.RwInvoiceWhereInput = {}
  if (q) {
    where.OR = [
      { invoiceNumber: { contains: q, mode: 'insensitive' } },
      { orderNumber: { contains: q, mode: 'insensitive' } },
      { customerName: { contains: q, mode: 'insensitive' } },
    ]
  }
  const now = new Date()
  // HQ-side "paid" overrides (RW lagging). Excluded from open, counted as paid.
  const hqPaidIds = await getHqPaidInvoiceIds()
  const notHqPaid: Prisma.RwInvoiceWhereInput = hqPaidIds.length ? { NOT: { rwInvoiceId: { in: hqPaidIds } } } : {}
  const paidSet = new Set(hqPaidIds)

  // Status-aware filters. VOID (cancelled) invoices keep a face-value
  // RemainingTotal in RW, so they must never count as owed.
  if (filter === 'open') Object.assign(where, { remainingTotal: { gt: 0 }, status: { not: RW_VOID }, ...notHqPaid })
  else if (filter === 'paid') where.AND = [{ OR: [{ status: RW_PAID }, ...(hqPaidIds.length ? [{ rwInvoiceId: { in: hqPaidIds } }] : [])] }]
  else if (filter === 'void') where.status = RW_VOID
  else if (filter === 'overdue') Object.assign(where, { remainingTotal: { gt: 0 }, status: { not: RW_VOID }, dueDate: { lt: now }, ...notHqPaid })

  // KPI tiles are computed over the true-open set, independent of the list
  // filter, so switching to Void/Paid doesn't zero the Outstanding figure.
  const openWhere: Prisma.RwInvoiceWhereInput = { ...OPEN_WHERE, ...notHqPaid }
  if (where.OR) openWhere.OR = where.OR // keep the search scope on the KPIs too

  const [rows, count, listAgg, openAgg, overdueAgg, syncRow] = await Promise.all([
    prisma.rwInvoice.findMany({
      where,
      orderBy: [{ invoiceDate: 'desc' }],
      skip: offset,
      take: limit,
      select: {
        id: true, rwInvoiceId: true, invoiceNumber: true, orderNumber: true, customerName: true, rwCustomerId: true,
        status: true, invoiceDate: true, dueDate: true, poNumber: true,
        invoiceTotal: true, receivedTotal: true, remainingTotal: true,
      },
    }),
    prisma.rwInvoice.count({ where }),
    prisma.rwInvoice.aggregate({ where, _sum: { invoiceTotal: true } }),
    prisma.rwInvoice.aggregate({ where: openWhere, _sum: { remainingTotal: true }, _count: { _all: true } }),
    prisma.rwInvoice.aggregate({
      where: { ...openWhere, dueDate: { lt: now } },
      _sum: { remainingTotal: true },
      _count: { _all: true },
    }),
    prisma.rwInvoice.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }),
  ])

  // Stitch HQ context: which client, and whether the order is linked to a job.
  const customerIds = [...new Set(rows.map((r) => r.rwCustomerId).filter(Boolean) as string[])]
  const orderNumbers = [...new Set(rows.map((r) => r.orderNumber).filter(Boolean) as string[])]
  const [companies, links] = await Promise.all([
    customerIds.length
      ? prisma.company.findMany({
          where: { rentalworksCustomerId: { in: customerIds } },
          select: { id: true, name: true, rentalworksCustomerId: true },
        })
      : Promise.resolve([]),
    orderNumbers.length
      ? prisma.jobRwOrder.findMany({
          where: { rwOrderNumber: { in: orderNumbers } },
          select: { rwOrderNumber: true, job: { select: { id: true, jobCode: true, name: true } } },
        })
      : Promise.resolve([]),
  ])
  const byCustomer = new Map(companies.map((c) => [c.rentalworksCustomerId as string, c]))
  const byOrder = new Map(links.map((l) => [l.rwOrderNumber, l.job]))
  const n = (v: unknown) => Number(v ?? 0)

  return NextResponse.json({
    syncedAt: syncRow?.syncedAt ?? null,
    count,
    totals: {
      invoiced: n(listAgg._sum.invoiceTotal),
      outstanding: n(openAgg._sum.remainingTotal),
      openCount: openAgg._count._all,
      overdue: n(overdueAgg._sum.remainingTotal),
      overdueCount: overdueAgg._count._all,
    },
    invoices: rows.map((r) => ({
      id: r.id,
      rwInvoiceId: r.rwInvoiceId,
      invoiceNumber: r.invoiceNumber,
      orderNumber: r.orderNumber,
      customerName: r.customerName,
      status: r.status,
      invoiceDate: r.invoiceDate,
      dueDate: r.dueDate,
      poNumber: r.poNumber,
      invoiceTotal: n(r.invoiceTotal),
      receivedTotal: n(r.receivedTotal),
      remainingTotal: n(r.remainingTotal),
      hqPaid: paidSet.has(r.rwInvoiceId),
      company: r.rwCustomerId ? byCustomer.get(r.rwCustomerId) ?? null : null,
      job: r.orderNumber ? byOrder.get(r.orderNumber) ?? null : null,
    })),
  })
}
