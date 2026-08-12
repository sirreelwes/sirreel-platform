import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
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
      id: true, jobCode: true, name: true, startDate: true,
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
        { name: j.name, agentName: j.agent?.name, startDate: j.startDate },
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
      score: s.score,
      reasons: s.reasons,
      distanceDays: s.distanceDays,
    }))

  return NextResponse.json({ suggestions, syncedAt })
}
