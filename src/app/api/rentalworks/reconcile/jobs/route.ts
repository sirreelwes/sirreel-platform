import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { getPermissions } from '@/lib/permissions'
import type { Prisma } from '@prisma/client'
import { RW_VOID } from '@/lib/rentalworks/arStatus'

export const dynamic = 'force-dynamic'

/**
 * GET /api/rentalworks/reconcile/jobs — the reconcile work queue.
 *
 * A flat "unlinked" list was misleading: of 63 unlinked jobs only ~14 were
 * actually actionable, the rest were blocked on a client link or had no RW
 * counterpart at all. So jobs are bucketed by what you can DO with them:
 *
 *   ready        — RW client linked AND unclaimed candidate orders exist
 *   needsClient  — no RW customer on the company (link that first)
 *   noMatch      — RW client linked but no unclaimed orders remain
 *   dismissed    — staff marked "not in RentalWorks" (HQ-native work)
 *   linked       — done
 *
 * Bucketing is batched: two extra queries regardless of job count.
 */
export async function GET(req: NextRequest) {
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

  const sp = req.nextUrl.searchParams
  const bucket = (sp.get('bucket') || 'ready').toLowerCase()
  const q = (sp.get('q') || '').trim()

  const base: Prisma.JobWhereInput = {
    archivedAt: null,
    NOT: { company: { name: { startsWith: 'ZZTEST', mode: 'insensitive' } } },
  }
  if (q) {
    base.OR = [
      { jobCode: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
      { company: { name: { contains: q, mode: 'insensitive' } } },
    ]
  }

  // Pull every candidate job once, then classify in memory.
  const all = await prisma.job.findMany({
    where: base,
    orderBy: [{ createdAt: 'desc' }],
    take: 500,
    select: {
      id: true, jobCode: true, name: true, status: true,
      createdAt: true, rwNotApplicable: true,
      company: { select: { id: true, name: true, rentalworksCustomerId: true } },
      rwOrders: { select: { rwOrderNumber: true } },
    },
  })

  // Which RW orders are already claimed by some job, and which orders exist
  // per RW customer — batched so bucketing costs two queries, not N.
  const customerIds = [
    ...new Set(all.map((j) => j.company?.rentalworksCustomerId).filter(Boolean) as string[]),
  ]
  const [claimedRows, orderRows] = await Promise.all([
    prisma.jobRwOrder.findMany({ select: { rwOrderNumber: true } }),
    customerIds.length
      ? prisma.rwInvoice.groupBy({
          by: ['rwCustomerId', 'orderNumber'],
          where: { rwCustomerId: { in: customerIds }, orderNumber: { not: null }, status: { not: RW_VOID } },
        })
      : Promise.resolve([] as Array<{ rwCustomerId: string | null; orderNumber: string | null }>),
  ])
  const claimed = new Set(claimedRows.map((l) => l.rwOrderNumber))
  const availableByCustomer = new Map<string, number>()
  for (const r of orderRows) {
    const cid = r.rwCustomerId as string
    const ord = r.orderNumber as string
    if (claimed.has(ord)) continue
    availableByCustomer.set(cid, (availableByCustomer.get(cid) ?? 0) + 1)
  }

  type Bucket = 'linked' | 'dismissed' | 'needsClient' | 'noMatch' | 'ready'
  const classify = (j: (typeof all)[number]): Bucket => {
    if (j.rwOrders.length > 0) return 'linked'
    if (j.rwNotApplicable) return 'dismissed'
    const cid = j.company?.rentalworksCustomerId
    if (!cid) return 'needsClient'
    return (availableByCustomer.get(cid) ?? 0) > 0 ? 'ready' : 'noMatch'
  }

  const tagged = all.map((j) => ({ job: j, bucket: classify(j) }))
  const counts = {
    ready: tagged.filter((t) => t.bucket === 'ready').length,
    needsClient: tagged.filter((t) => t.bucket === 'needsClient').length,
    noMatch: tagged.filter((t) => t.bucket === 'noMatch').length,
    dismissed: tagged.filter((t) => t.bucket === 'dismissed').length,
    linked: tagged.filter((t) => t.bucket === 'linked').length,
  }

  const wanted = ['ready', 'needsClient', 'noMatch', 'dismissed', 'linked'].includes(bucket)
    ? tagged.filter((t) => t.bucket === bucket)
    : tagged

  return NextResponse.json({
    counts,
    jobs: wanted.map(({ job: j, bucket: b }) => ({
      id: j.id,
      jobCode: j.jobCode,
      name: j.name,
      status: j.status,
      createdAt: j.createdAt,
      company: j.company ? { id: j.company.id, name: j.company.name } : null,
      companyRwLinked: !!j.company?.rentalworksCustomerId,
      linkedOrders: j.rwOrders.map((o) => o.rwOrderNumber),
      bucket: b,
      candidateCount: j.company?.rentalworksCustomerId
        ? availableByCustomer.get(j.company.rentalworksCustomerId) ?? 0
        : 0,
    })),
  })
}

/**
 * POST { jobIds: string[], notApplicable: boolean } — mark jobs as having no
 * RentalWorks counterpart (or undo). Lets the queue reach zero instead of
 * accumulating HQ-native jobs forever.
 */
export async function POST(req: NextRequest) {
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

  const body = (await req.json().catch(() => ({}))) as { jobIds?: unknown; notApplicable?: unknown }
  const jobIds = Array.isArray(body.jobIds) ? body.jobIds.filter((x): x is string => typeof x === 'string') : []
  if (!jobIds.length) return NextResponse.json({ error: 'jobIds required' }, { status: 400 })
  const notApplicable = body.notApplicable !== false

  const result = await prisma.job.updateMany({
    where: { id: { in: jobIds.slice(0, 500) } },
    data: { rwNotApplicable: notApplicable ? new Date() : null },
  })
  return NextResponse.json({ ok: true, updated: result.count })
}
