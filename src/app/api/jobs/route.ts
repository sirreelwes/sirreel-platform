import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { JobStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

// GET /api/jobs?companyId=xxx&status=ACTIVE&search=foo
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId')
  const status = searchParams.get('status') as JobStatus | null
  const search = searchParams.get('search')

  try {
    const jobs = await prisma.job.findMany({
      where: {
        ...(companyId && { companyId }),
        ...(status && { status }),
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
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return NextResponse.json({ jobs })
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
      agentId,
      notes,
      contacts, // [{ personId, role, isPrimary }]
    } = body

    if (!name || !companyId || !agentId) {
      return NextResponse.json(
        { error: 'name, companyId, and agentId are required' },
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

    return NextResponse.json({ job }, { status: 201 })
  } catch (error) {
    console.error('POST /api/jobs error:', error)
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
  }
}
