import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Job ↔ RentalWorks ORDER linkage, and the AR that follows from it.
 *
 * RW invoices carry an OrderNumber and one order has many invoices, so we
 * link at the ORDER level — every current and future invoice on that order
 * then rolls up to the job automatically on each sync.
 *
 * GET    → linked orders + their invoices/rollup + ranked candidates
 * POST   { rwOrderNumber } → link
 * DELETE ?orderNumber=…    → unlink
 */

const n = (v: unknown) => Number(v ?? 0)

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const job = await prisma.job.findUnique({
    where: { id: params.id },
    select: {
      id: true, startDate: true, endDate: true,
      company: { select: { name: true, rentalworksCustomerId: true } },
      rwOrders: { select: { rwOrderNumber: true, createdAt: true } },
    },
  })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const linkedNumbers = job.rwOrders.map((o) => o.rwOrderNumber)
  const rwCustomerId = job.company?.rentalworksCustomerId ?? null

  // Invoices on the linked orders — the job's AR.
  const invoices = linkedNumbers.length
    ? await prisma.rwInvoice.findMany({
        where: { orderNumber: { in: linkedNumbers } },
        orderBy: [{ invoiceDate: 'desc' }],
        select: {
          id: true, invoiceNumber: true, status: true, invoiceDate: true, dueDate: true,
          orderNumber: true, invoiceTotal: true, receivedTotal: true, remainingTotal: true,
          syncedAt: true,
        },
      })
    : []

  const open = invoices.filter((i) => n(i.remainingTotal) > 0.005)
  const rollup = {
    invoiced: invoices.reduce((s, i) => s + n(i.invoiceTotal), 0),
    received: invoices.reduce((s, i) => s + n(i.receivedTotal), 0),
    outstanding: open.reduce((s, i) => s + n(i.remainingTotal), 0),
    openCount: open.length,
    invoiceCount: invoices.length,
  }

  // Candidate RW orders for this client, ranked by date fit to the job.
  let candidates: Array<Record<string, unknown>> = []
  if (rwCustomerId) {
    const grouped = await prisma.rwInvoice.groupBy({
      by: ['orderNumber'],
      where: { rwCustomerId, orderNumber: { not: null } },
      _sum: { invoiceTotal: true, remainingTotal: true },
      _count: { _all: true },
      _min: { invoiceDate: true },
      _max: { invoiceDate: true },
    })
    const anchor = job.startDate ? new Date(job.startDate).getTime() : null
    candidates = grouped
      .filter((g) => g.orderNumber && !linkedNumbers.includes(g.orderNumber))
      .map((g) => {
        const first = g._min.invoiceDate ? new Date(g._min.invoiceDate).getTime() : null
        const distanceDays =
          anchor != null && first != null ? Math.abs(first - anchor) / 86_400_000 : null
        return {
          orderNumber: g.orderNumber,
          invoiceCount: g._count._all,
          invoiced: n(g._sum.invoiceTotal),
          outstanding: n(g._sum.remainingTotal),
          firstInvoiceDate: g._min.invoiceDate,
          lastInvoiceDate: g._max.invoiceDate,
          distanceDays: distanceDays == null ? null : Math.round(distanceDays),
        }
      })
      .sort((a, b) => {
        const ad = a.distanceDays as number | null
        const bd = b.distanceDays as number | null
        if (ad == null && bd == null) return 0
        if (ad == null) return 1
        if (bd == null) return -1
        return ad - bd
      })
      .slice(0, 25)
  }

  return NextResponse.json({
    companyLinked: !!rwCustomerId,
    companyName: job.company?.name ?? null,
    linked: job.rwOrders,
    syncedAt: invoices[0]?.syncedAt ?? null,
    rollup,
    invoices: invoices.map((i) => ({
      ...i,
      invoiceTotal: n(i.invoiceTotal),
      receivedTotal: n(i.receivedTotal),
      remainingTotal: n(i.remainingTotal),
    })),
    candidates,
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { rwOrderNumber?: unknown }
  const rwOrderNumber = String(body.rwOrderNumber ?? '').trim().slice(0, 40)
  if (!rwOrderNumber) return NextResponse.json({ error: 'rwOrderNumber required' }, { status: 400 })

  const job = await prisma.job.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })

  const link = await prisma.jobRwOrder.upsert({
    where: { jobId_rwOrderNumber: { jobId: params.id, rwOrderNumber } },
    create: { jobId: params.id, rwOrderNumber, linkedById: user?.id ?? null },
    update: {},
    select: { rwOrderNumber: true },
  })
  return NextResponse.json({ ok: true, link }, { status: 201 })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rwOrderNumber = req.nextUrl.searchParams.get('orderNumber')?.trim()
  if (!rwOrderNumber) return NextResponse.json({ error: 'orderNumber required' }, { status: 400 })

  await prisma.jobRwOrder.deleteMany({ where: { jobId: params.id, rwOrderNumber } })
  return NextResponse.json({ ok: true })
}
