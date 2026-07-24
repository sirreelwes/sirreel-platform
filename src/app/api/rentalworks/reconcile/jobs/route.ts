import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/rentalworks/reconcile/jobs — the left rail of the RW
 * reconciliation workspace.
 *
 * Linking a job to an RW order is a judgement call, so the workspace shows
 * the job, its client, what they rented and the email trail beside the
 * candidate invoices. This just lists the jobs to work through.
 *
 * ?filter=unlinked | linked | all   (default unlinked)
 * ?q= job code, job name, or client
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const filter = (sp.get('filter') || 'unlinked').toLowerCase()
  const q = (sp.get('q') || '').trim()

  const where: Prisma.JobWhereInput = {
    archivedAt: null,
    // Hide ZZTEST fixtures (the documented live-DB test prefix).
    NOT: { company: { name: { startsWith: 'ZZTEST', mode: 'insensitive' } } },
  }
  if (q) {
    where.OR = [
      { jobCode: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
      { company: { name: { contains: q, mode: 'insensitive' } } },
    ]
  }
  if (filter === 'unlinked') where.rwOrders = { none: {} }
  else if (filter === 'linked') where.rwOrders = { some: {} }

  // Most-recently-created first — this is a work queue for new jobs, and
  // ordering by startDate floated the (few) date-less jobs to the top.
  const jobs = await prisma.job.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }],
    take: 300,
    select: {
      id: true, jobCode: true, name: true, status: true,
      startDate: true, endDate: true, createdAt: true,
      company: { select: { id: true, name: true, rentalworksCustomerId: true } },
      rwOrders: { select: { rwOrderNumber: true } },
    },
  })

  return NextResponse.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      jobCode: j.jobCode,
      name: j.name,
      status: j.status,
      startDate: j.startDate,
      endDate: j.endDate,
      createdAt: j.createdAt,
      company: j.company ? { id: j.company.id, name: j.company.name } : null,
      companyRwLinked: !!j.company?.rentalworksCustomerId,
      linkedOrders: j.rwOrders.map((o) => o.rwOrderNumber),
    })),
  })
}
