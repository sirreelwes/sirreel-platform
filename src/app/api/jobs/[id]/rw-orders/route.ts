import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { RW_VOID, getHqPaidInvoiceIds } from '@/lib/rentalworks/arStatus'

export const dynamic = 'force-dynamic'

/**
 * Job ↔ RentalWorks ORDER linkage, and the AR that follows from it.
 *
 * RW invoices carry an OrderNumber and one order has many invoices, so we
 * link at the ORDER level — every current and future invoice on that order
 * then rolls up to the job automatically on each sync.
 *
 * Candidates are SCORED on real evidence, not just a date guess:
 *   - RW `Deal` is the production name and lines up with Job.name
 *   - RW `Agent` lines up with the job's agent
 *   - RW billing dates are the true rental window
 * Deal-name matching still works when the job has no dates at all, which is
 * common. Nothing auto-links; the score only orders the list.
 */

const n = (v: unknown) => Number(v ?? 0)

/** lowercase, strip punctuation, collapse whitespace */
function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}
/** "Carlson, Oliver" -> "oliver carlson" */
function normAgent(s: string | null | undefined): string {
  const raw = (s ?? '').trim()
  if (!raw) return ''
  return norm(raw.includes(',') ? raw.split(',').reverse().join(' ') : raw)
}
function tokens(s: string): string[] {
  return norm(s).split(' ').filter((t) => t.length > 2)
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const job = await prisma.job.findUnique({
    where: { id: params.id },
    select: {
      id: true, name: true, startDate: true, endDate: true,
      agent: { select: { name: true } },
      company: { select: { name: true, rentalworksCustomerId: true } },
      rwOrders: { select: { rwOrderNumber: true, createdAt: true } },
    },
  })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const linkedNumbers = job.rwOrders.map((o) => o.rwOrderNumber)
  const rwCustomerId = job.company?.rentalworksCustomerId ?? null

  const invSelect = {
    id: true, rwInvoiceId: true, invoiceNumber: true, status: true, invoiceDate: true, dueDate: true,
    orderNumber: true, poNumber: true, dealName: true, orderDescription: true,
    agent: true, billingStartDate: true, billingEndDate: true,
    invoiceTotal: true, receivedTotal: true, remainingTotal: true, syncedAt: true,
  } as const

  const invoices = linkedNumbers.length
    ? await prisma.rwInvoice.findMany({
        where: { orderNumber: { in: linkedNumbers }, status: { not: RW_VOID } },
        orderBy: [{ invoiceDate: 'desc' }],
        select: invSelect,
      })
    : []

  const hqPaid = new Set(await getHqPaidInvoiceIds())
  const open = invoices.filter((i) => n(i.remainingTotal) > 0.005 && !hqPaid.has(i.rwInvoiceId))
  const rollup = {
    invoiced: invoices.reduce((s, i) => s + n(i.invoiceTotal), 0),
    received: invoices.reduce((s, i) => s + n(i.receivedTotal), 0),
    outstanding: open.reduce((s, i) => s + n(i.remainingTotal), 0),
    openCount: open.length,
    invoiceCount: invoices.length,
  }

  // ── Candidates: group this client's invoices by order, then score ──
  let candidates: Array<Record<string, unknown>> = []
  if (rwCustomerId) {
    const all = await prisma.rwInvoice.findMany({
      where: { rwCustomerId, orderNumber: { not: null }, status: { not: RW_VOID } },
      orderBy: [{ invoiceDate: 'desc' }],
      select: invSelect,
    })

    const groups = new Map<string, typeof all>()
    for (const inv of all) {
      const key = inv.orderNumber as string
      if (linkedNumbers.includes(key)) continue
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(inv)
    }

    const jobName = norm(job.name)
    const jobTokens = tokens(job.name)
    const jobAgent = normAgent(job.agent?.name)
    const jobStart = job.startDate ? new Date(job.startDate).getTime() : null

    candidates = [...groups.entries()].map(([orderNumber, rows]) => {
      const first = rows[rows.length - 1]
      const deal = first.dealName ?? null
      const desc = first.orderDescription ?? null
      const agent = first.agent ?? null
      const billStart = rows.map((r) => r.billingStartDate).find(Boolean) ?? null
      const billEnd = rows.map((r) => r.billingEndDate).find(Boolean) ?? null

      // Evidence scoring
      let score = 0
      const reasons: string[] = []
      const dealN = norm(deal)
      if (dealN && jobName) {
        if (dealN === jobName) { score += 100; reasons.push('deal name matches job') }
        else if (dealN.includes(jobName) || jobName.includes(dealN)) { score += 60; reasons.push('deal name overlaps job') }
        else {
          const dt = tokens(deal ?? '')
          const shared = jobTokens.filter((t) => dt.includes(t))
          if (shared.length) { score += 30; reasons.push(`shares “${shared[0]}”`) }
        }
      }
      if (jobAgent && normAgent(agent) === jobAgent) { score += 40; reasons.push('same agent') }

      const anchorDate = billStart ?? first.invoiceDate
      let distanceDays: number | null = null
      if (jobStart != null && anchorDate) {
        distanceDays = Math.round(Math.abs(new Date(anchorDate).getTime() - jobStart) / 86_400_000)
        if (distanceDays <= 3) { score += 50; reasons.push('dates line up') }
        else if (distanceDays <= 14) { score += 25; reasons.push('dates close') }
        else if (distanceDays > 120) { score -= 20 }
      }

      return {
        orderNumber,
        dealName: deal,
        orderDescription: desc,
        agent,
        billingStartDate: billStart,
        billingEndDate: billEnd,
        invoiceCount: rows.length,
        invoiced: rows.reduce((s, r) => s + n(r.invoiceTotal), 0),
        outstanding: rows.filter((r) => !hqPaid.has(r.rwInvoiceId)).reduce((s, r) => s + n(r.remainingTotal), 0),
        firstInvoiceDate: rows[rows.length - 1]?.invoiceDate ?? null,
        lastInvoiceDate: rows[0]?.invoiceDate ?? null,
        distanceDays,
        score,
        reasons,
        invoices: rows.map((r) => ({
          ...r,
          invoiceTotal: n(r.invoiceTotal),
          receivedTotal: n(r.receivedTotal),
          remainingTotal: n(r.remainingTotal),
        })),
      }
    })
      .sort((a, b) => {
        const s = (b.score as number) - (a.score as number)
        if (s !== 0) return s
        const ad = a.distanceDays as number | null
        const bd = b.distanceDays as number | null
        if (ad == null && bd == null) return 0
        if (ad == null) return 1
        if (bd == null) return -1
        return ad - bd
      })
      .slice(0, 40)
  }

  return NextResponse.json({
    companyLinked: !!rwCustomerId,
    companyName: job.company?.name ?? null,
    jobName: job.name,
    jobAgent: job.agent?.name ?? null,
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
