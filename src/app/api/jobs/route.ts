import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import type { JobStatus, OrderStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

// GET /api/jobs?companyId=xxx&status=ACTIVE&statuses=QUOTED,ACTIVE&agentId=xxx&mine=1&search=foo
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId')
  const status = searchParams.get('status') as JobStatus | null
  const statusesParam = searchParams.get('statuses')
  let agentId = searchParams.get('agentId')
  const mine = searchParams.get('mine') === '1'
  const search = searchParams.get('search')

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
        ...(statuses && statuses.length > 0 ? { status: { in: statuses } } : status ? { status } : {}),
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
          select: { status: true, subtotal: true },
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

      const primaryContact =
        j.jobContacts.find((jc) => jc.role === 'PM' && jc.isPrimary) ||
        j.jobContacts.find((jc) => jc.role === 'PM') ||
        j.jobContacts.find((jc) => jc.role === 'PC' && jc.isPrimary) ||
        j.jobContacts.find((jc) => jc.role === 'PC') ||
        j.jobContacts.find((jc) => jc.isPrimary) ||
        j.jobContacts[0] ||
        null

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
