import { NextRequest, NextResponse } from 'next/server'
import { deriveJobDateRange } from '@/lib/jobs/dateRange'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { getPermissions } from '@/lib/permissions'
import { RW_VOID } from '@/lib/rentalworks/arStatus'
import { scoreOrderMatch, isSuggestable } from '@/lib/rentalworks/matchOrders'

export const dynamic = 'force-dynamic'

/**
 * GET /api/rentalworks/reconcile/suggestions — the one-click queue.
 *
 * Cross-references every UNLINKED job (whose client is RW-linked) against
 * its client's unclaimed RW orders and returns only the high-confidence
 * pairs (exact/overlapping deal name, or same-agent + dates lining up).
 * Each order is suggested for at most ONE job (greedy by score), so two
 * jobs never both claim the same order from the queue. Confirmation is
 * still a human click — this only ranks.
 */

const n = (v: unknown) => Number(v ?? 0)

export async function GET(_req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { role: true, salesOnly: true, email: true },
  })
  // Billing surface — same predicate as the nav group (salesOnly strip
  // honored). See 2026-08-24 by-URL probe.
  if (!actor || !getPermissions({ role: actor.role, salesOnly: actor.salesOnly, email: actor.email }).billing) {
    return NextResponse.json({ error: 'forbidden', reason: 'reconcile is a billing surface' }, { status: 403 })
  }

  const jobs = await prisma.job.findMany({
    where: {
      archivedAt: null,
      rwOrders: { none: {} },
      rwNotApplicable: null, // dismissed jobs are out of the queue
      company: {
        rentalworksCustomerId: { not: null },
        NOT: { name: { startsWith: 'ZZTEST', mode: 'insensitive' } },
      },
    },
    select: {
      id: true, jobCode: true, name: true,
      // The RW matcher scores on how close a job's start is to an
      // invoice's billing date. Job dates were dropped 2026-08-31, so
      // that start is derived from what is scheduled — which is also
      // more accurate than the stale column ever was here.
      orders: { select: { startDate: true, endDate: true, status: true } },
      bookings: { select: { startDate: true, endDate: true, status: true } },
      agent: { select: { name: true } },
      company: { select: { id: true, name: true, rentalworksCustomerId: true } },
    },
  })
  // Age of the mirror these suggestions are computed FROM. Reconcile matches
  // HQ jobs to RW orders on invoice evidence, so a stale mirror produces
  // confident-looking matches against invoices that may already be settled.
  const freshest = await prisma.rwInvoice.aggregate({ _max: { syncedAt: true } })
  const syncedAt = freshest._max.syncedAt ?? null

  if (!jobs.length) return NextResponse.json({ suggestions: [], syncedAt })

  // Orders already claimed by ANY job are off the table.
  const claimed = new Set(
    (await prisma.jobRwOrder.findMany({ select: { rwOrderNumber: true } })).map((l) => l.rwOrderNumber),
  )

  const customerIds = [...new Set(jobs.map((j) => j.company!.rentalworksCustomerId as string))]
  const invoices = await prisma.rwInvoice.findMany({
    where: { rwCustomerId: { in: customerIds }, orderNumber: { not: null }, status: { not: RW_VOID } },
    orderBy: [{ invoiceDate: 'desc' }],
    select: {
      rwCustomerId: true, orderNumber: true, dealName: true, orderDescription: true,
      agent: true, billingStartDate: true, billingEndDate: true, invoiceDate: true,
      invoiceTotal: true, remainingTotal: true,
    },
  })

  // Group per customer → order.
  type Group = {
    orderNumber: string; dealName: string | null; orderDescription: string | null;
    agent: string | null; billingStartDate: Date | null; billingEndDate: Date | null;
    firstInvoiceDate: Date | null; invoiceCount: number; invoiced: number; outstanding: number;
    /// 'invoice' = grounded in invoice rows; 'quote' = pre-invoice, from the
    /// RW quote mirror (2026-08-22) — connect the job BEFORE the money lands.
    source: 'invoice' | 'quote';
  }
  const byCustomer = new Map<string, Map<string, Group>>()
  for (const inv of invoices) {
    const cid = inv.rwCustomerId as string
    const ord = inv.orderNumber as string
    if (claimed.has(ord)) continue
    if (!byCustomer.has(cid)) byCustomer.set(cid, new Map())
    const orders = byCustomer.get(cid)!
    const g = orders.get(ord) ?? {
      orderNumber: ord, dealName: inv.dealName, orderDescription: inv.orderDescription,
      agent: inv.agent, billingStartDate: inv.billingStartDate, billingEndDate: inv.billingEndDate,
      firstInvoiceDate: inv.invoiceDate, invoiceCount: 0, invoiced: 0, outstanding: 0,
      source: 'invoice' as const,
    }
    g.invoiceCount++
    g.invoiced += n(inv.invoiceTotal)
    g.outstanding += n(inv.remainingTotal)
    g.billingStartDate = g.billingStartDate ?? inv.billingStartDate
    g.billingEndDate = g.billingEndDate ?? inv.billingEndDate
    // invoices are date-desc; the last row seen is the earliest
    g.firstInvoiceDate = inv.invoiceDate ?? g.firstInvoiceDate
    orders.set(ord, g)
  }

  // Fold in QUOTE evidence (2026-08-22): RW quotes share the order-number
  // sequence, so a pre-invoice quote suggests the same link an invoice
  // would — just earlier. Invoice evidence wins when both exist for a
  // number (the invoice grouping above already claimed the map slot).
  const quotes = await prisma.rwQuote.findMany({
    // CANCELLED quotes are dead paper — suggesting them would link jobs to
    // money that will never arrive. (Live statuses 2026-08-22: ORDERED,
    // ACTIVE, PROSPECT, HOLD, CLOSED, CANCELLED.)
    where: { rwCustomerId: { in: customerIds }, orderNumber: { not: null }, status: { not: 'CANCELLED' } },
    select: {
      rwCustomerId: true, orderNumber: true, dealName: true, description: true,
      agent: true, startDate: true, endDate: true, quoteDate: true, total: true,
    },
  })
  for (const q of quotes) {
    const cid = q.rwCustomerId as string
    const ord = q.orderNumber as string
    if (claimed.has(ord)) continue
    if (!byCustomer.has(cid)) byCustomer.set(cid, new Map())
    const orders = byCustomer.get(cid)!
    if (orders.has(ord)) continue // invoice evidence already covers it
    orders.set(ord, {
      orderNumber: ord, dealName: q.dealName, orderDescription: q.description,
      agent: q.agent, billingStartDate: q.startDate, billingEndDate: q.endDate,
      firstInvoiceDate: q.quoteDate, invoiceCount: 0,
      invoiced: Number(q.total ?? 0), outstanding: 0,
      source: 'quote' as const,
    })
  }

  // Best suggestable order per job.
  const raw: Array<{
    jobId: string; jobCode: string; jobName: string; companyName: string;
    order: Group; score: number; reasons: string[]; distanceDays: number | null;
  }> = []
  for (const j of jobs) {
    const orders = byCustomer.get(j.company!.rentalworksCustomerId as string)
    if (!orders) continue
    let best: { g: Group; score: number; reasons: string[]; distanceDays: number | null } | null = null
    for (const g of orders.values()) {
      const m = scoreOrderMatch(
        {
          name: j.name,
          agentName: j.agent?.name,
          startDate: deriveJobDateRange(j.orders, j.bookings).start,
        },
        { dealName: g.dealName, agent: g.agent, billingStartDate: g.billingStartDate, firstInvoiceDate: g.firstInvoiceDate },
      )
      if (!isSuggestable(m)) continue
      if (!best || m.score > best.score) best = { g, score: m.score, reasons: m.reasons, distanceDays: m.distanceDays }
    }
    if (best) {
      raw.push({
        jobId: j.id, jobCode: j.jobCode, jobName: j.name, companyName: j.company!.name,
        order: best.g, score: best.score, reasons: best.reasons, distanceDays: best.distanceDays,
      })
    }
  }

  // One order → one job (greedy by score).
  raw.sort((a, b) => b.score - a.score)
  const takenOrders = new Set<string>()
  const suggestions = raw
    .filter((s) => {
      if (takenOrders.has(s.order.orderNumber)) return false
      takenOrders.add(s.order.orderNumber)
      return true
    })
    .slice(0, 20)
    .map((s) => ({
      jobId: s.jobId,
      jobCode: s.jobCode,
      jobName: s.jobName,
      companyName: s.companyName,
      orderNumber: s.order.orderNumber,
      dealName: s.order.dealName,
      orderDescription: s.order.orderDescription,
      agent: s.order.agent,
      billingStartDate: s.order.billingStartDate,
      billingEndDate: s.order.billingEndDate,
      invoiceCount: s.order.invoiceCount,
      invoiced: Math.round(s.order.invoiced * 100) / 100,
      outstanding: Math.round(s.order.outstanding * 100) / 100,
      source: s.order.source,
      score: s.score,
      reasons: s.reasons,
      distanceDays: s.distanceDays,
    }))

  return NextResponse.json({ suggestions, syncedAt })
}
