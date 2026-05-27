import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import type { JobStatus, OrderStatus, OrderQuoteStatus, LineItemDepartment } from '@prisma/client'
import { derivePipelineColumn, type PipelineColumn } from '@/lib/sales/pipeline'
import { pickPrimaryContact } from '@/lib/jobs/primaryContact'
import { recomputeMostCommonProductionTypeProfile } from '@/lib/companies/recomputeMostCommonProductionTypeProfile'

export const dynamic = 'force-dynamic'

// GET /api/jobs?companyId=xxx&status=ACTIVE&statuses=QUOTED,ACTIVE&agentId=xxx&mine=1&search=foo
//                &include=quoteStatus,departments  (Phase 1 sales pipeline)
//                &orphans=1  (only QUOTED jobs with no sent/durable order)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId')
  const status = searchParams.get('status') as JobStatus | null
  const statusesParam = searchParams.get('statuses')
  let agentId = searchParams.get('agentId')
  const mine = searchParams.get('mine') === '1'
  const search = searchParams.get('search')
  const orphans = searchParams.get('orphans') === '1'
  const includeParam = searchParams.get('include') || ''
  const includes = new Set(includeParam.split(',').map((s) => s.trim()).filter(Boolean))
  const includeQuoteStatus = includes.has('quoteStatus')
  const includeDepartments = includes.has('departments')

  const statuses = statusesParam
    ? (statusesParam.split(',').filter(Boolean) as JobStatus[])
    : null

  // Resolve mine=1 to the session user's id
  if (mine && !agentId) {
    const session = await getServerSession()
    if (session?.user?.email) {
      const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true },
      })
      if (user) agentId = user.id
      else return NextResponse.json({ jobs: [] })
    } else {
      return NextResponse.json({ jobs: [] })
    }
  }

  try {
    const jobs = await prisma.job.findMany({
      where: {
        ...(companyId && { companyId }),
        ...(agentId && { agentId }),
        // `orphans=1` overrides the status filter — it's QUOTED + no
        // sent/durable order. "Durable" = any order that has progressed
        // past DRAFT (quoteStatus IN SENT/WON/LOST/EXPIRED). A job with
        // zero orders or only DRAFT orders qualifies.
        ...(orphans
          ? {
              status: 'QUOTED' as JobStatus,
              orders: { none: { quoteStatus: { in: ['SENT', 'WON', 'LOST', 'EXPIRED'] } } },
            }
          : statuses && statuses.length > 0
          ? { status: { in: statuses } }
          : status
          ? { status }
          : {}),
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { jobCode: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      include: {
        company: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
        jobContacts: {
          include: {
            person: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
        orders: {
          select: {
            status: true,
            subtotal: true,
            ...(includeQuoteStatus ? { quoteStatus: true } : {}),
            ...(includeDepartments
              ? {
                  lineItems: {
                    select: { department: true },
                  },
                }
              : {}),
          },
        },
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    const enriched = jobs.map((j) => {
      const orderTotal = j.orders
        .filter((o) => o.status !== ('CANCELLED' as OrderStatus))
        .reduce((sum, o) => sum + Number(o.subtotal || 0), 0)

      const primaryContact = pickPrimaryContact(j.jobContacts)

      let pipelineColumn: PipelineColumn | null = null
      let quoteBreakdown:
        | { quotes: number; won: number; pending: number; lost: number; expired: number }
        | undefined
      let departments: LineItemDepartment[] | undefined

      if (includeQuoteStatus) {
        const qs = j.orders
          .map((o) => (o as { quoteStatus?: OrderQuoteStatus }).quoteStatus)
          .filter((s): s is OrderQuoteStatus => !!s)
        pipelineColumn = derivePipelineColumn(qs)
        quoteBreakdown = {
          quotes: qs.length,
          won: qs.filter((s) => s === 'WON').length,
          pending: qs.filter((s) => s === 'DRAFT' || s === 'SENT').length,
          lost: qs.filter((s) => s === 'LOST').length,
          expired: qs.filter((s) => s === 'EXPIRED').length,
        }
      }

      if (includeDepartments) {
        const deptSet = new Set<LineItemDepartment>()
        for (const o of j.orders) {
          const lis = (o as { lineItems?: { department: LineItemDepartment }[] }).lineItems
          if (lis) for (const li of lis) deptSet.add(li.department)
        }
        departments = Array.from(deptSet)
      }

      const { orders, ...rest } = j
      return {
        ...rest,
        estimatedValue: j.estimatedValue == null ? null : Number(j.estimatedValue),
        orderTotal,
        primaryContact: primaryContact
          ? {
              id: primaryContact.person.id,
              firstName: primaryContact.person.firstName,
              lastName: primaryContact.person.lastName,
              email: primaryContact.person.email,
              role: primaryContact.role,
              isPrimary: primaryContact.isPrimary,
            }
          : null,
        ...(includeQuoteStatus ? { pipelineColumn, quoteBreakdown } : {}),
        ...(includeDepartments ? { departments } : {}),
      }
    })

    return NextResponse.json({ jobs: enriched })
  } catch (error) {
    console.error('GET /api/jobs error:', error)
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })
  }
}

// POST /api/jobs
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      name,
      companyId,
      productionType,
      productionTypeProfileId,
      status,
      startDate,
      endDate,
      notes,
      estimatedValue,
      contacts, // [{ personId, role, isPrimary }]
    } = body
    let { agentId } = body

    // Fall back to logged-in user for agentId if not supplied
    if (!agentId) {
      const session = await getServerSession()
      if (session?.user?.email) {
        const user = await prisma.user.findUnique({
          where: { email: session.user.email },
          select: { id: true },
        })
        if (user) agentId = user.id
      }
    }

    if (!name || !companyId || !agentId) {
      return NextResponse.json(
        {
          error: 'name, companyId, and agentId are required',
          gotName: !!name,
          gotCompanyId: !!companyId,
          gotAgentId: !!agentId,
        },
        { status: 400 }
      )
    }

    // Generate next jobCode (SR-JOB-0001 pattern)
    const lastJob = await prisma.job.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { jobCode: true },
    })
    const nextNum = lastJob
      ? parseInt(lastJob.jobCode.replace('SR-JOB-', ''), 10) + 1
      : 1
    const jobCode = `SR-JOB-${String(nextNum).padStart(4, '0')}`

    const job = await prisma.job.create({
      data: {
        jobCode,
        name,
        companyId,
        productionType: productionType || 'OTHER',
        // Optional FK to the new ProductionTypeProfile lookup. Empty
        // string → null so the form-default of '' doesn't FK-error.
        productionTypeProfileId:
          typeof productionTypeProfileId === 'string' && productionTypeProfileId
            ? productionTypeProfileId
            : null,
        status: status || 'QUOTED',
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        agentId,
        notes,
        estimatedValue:
          estimatedValue == null || estimatedValue === '' ? null : Number(estimatedValue),
        ...(contacts && contacts.length > 0 && {
          jobContacts: {
            create: contacts.map((c: any) => ({
              personId: c.personId,
              role: c.role,
              isPrimary: c.isPrimary || false,
            })),
          },
        }),
      },
      include: {
        company: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
        jobContacts: { include: { person: true } },
      },
    })

    // Refresh the Company's most-common-profile cache. Awaited (not
    // fire-and-forget) so the Company row is consistent on the
    // response — Vercel cuts off promises after the response is
    // returned, so detached recompute would risk being killed mid-
    // query. Negligible latency (one indexed findMany + one update).
    try {
      await recomputeMostCommonProductionTypeProfile(companyId)
    } catch (err) {
      // Don't block the Job-create response on a cache-refresh failure;
      // the next Job-create or a manual backfill will reconcile.
      console.warn('[jobs POST] recompute most-common profile failed:', err)
    }

    return NextResponse.json(
      {
        job: {
          ...job,
          estimatedValue: job.estimatedValue == null ? null : Number(job.estimatedValue),
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('POST /api/jobs error:', error)
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
  }
}
