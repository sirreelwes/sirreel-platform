/**
 * GET /api/reports/orders/search?q= — find an order to check out or in by
 * job name, company, order number or job code (Wes 2026-09-16, from the
 * warehouse: "a search bar at the top of the page so they can search the job
 * name or company name and it pulls up the order").
 *
 * Not limited to the page's seven-day window: the order someone is holding
 * paperwork for may be outside it. Newest-starting first; cancelled orders
 * are never offered.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireYardAccess } from '@/lib/yard/requireYardAccess'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requireYardAccess()
  if (!auth.ok) return auth.response
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ ok: true, orders: [] })

  const contains = { contains: q, mode: 'insensitive' as const }
  const rows = await prisma.order.findMany({
    where: {
      status: { not: 'CANCELLED' },
      OR: [
        { orderNumber: contains },
        { job: { name: contains } },
        { job: { jobCode: contains } },
        { company: { name: contains } },
      ],
    },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    take: 12,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      startDate: true,
      endDate: true,
      job: { select: { name: true, jobCode: true } },
      company: { select: { name: true } },
      checkReports: { select: { edge: true, partial: true } },
    },
  })

  return NextResponse.json({
    ok: true,
    orders: rows.map((o) => ({
      orderId: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      jobName: o.job?.name ?? null,
      jobCode: o.job?.jobCode ?? null,
      company: o.company?.name ?? null,
      startDate: o.startDate ? o.startDate.toISOString().slice(0, 10) : null,
      endDate: o.endDate ? o.endDate.toISOString().slice(0, 10) : null,
      outFiled: o.checkReports.some((r) => r.edge === 'OUT' && !r.partial),
      inFiled: o.checkReports.some((r) => r.edge === 'IN' && !r.partial),
    })),
  })
}
