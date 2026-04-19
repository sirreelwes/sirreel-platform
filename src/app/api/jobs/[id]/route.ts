import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/jobs/:id
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const job = await prisma.job.findUnique({
      where: { id: params.id },
      include: {
        company: true,
        agent: { select: { id: true, name: true, email: true } },
        jobContacts: {
          include: { person: true },
          orderBy: [{ isPrimary: 'desc' }, { role: 'asc' }],
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            subtotal: true,
            total: true,
            startDate: true,
            endDate: true,
            createdAt: true,
          },
        },
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Compute primary contact: PM > PC > first marked primary > first contact
    const primaryContact =
      job.jobContacts.find(jc => jc.role === 'PM' && jc.isPrimary) ||
      job.jobContacts.find(jc => jc.role === 'PM') ||
      job.jobContacts.find(jc => jc.role === 'PC' && jc.isPrimary) ||
      job.jobContacts.find(jc => jc.role === 'PC') ||
      job.jobContacts.find(jc => jc.isPrimary) ||
      job.jobContacts[0] ||
      null

    const orderTotal = job.orders
      .filter(o => o.status !== 'CANCELLED')
      .reduce((sum, o) => sum + Number(o.subtotal || 0), 0)

    return NextResponse.json({
      job: {
        ...job,
        estimatedValue: job.estimatedValue == null ? null : Number(job.estimatedValue),
        orderTotal,
        orders: job.orders.map(o => ({
          ...o,
          subtotal: Number(o.subtotal || 0),
          total: Number(o.total || 0),
        })),
        primaryContact,
      },
    })
  } catch (error) {
    console.error(`GET /api/jobs/${params.id} error:`, error)
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 })
  }
}

// PATCH /api/jobs/:id
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()
    const { name, status, startDate, endDate, productionType, agentId, notes, estimatedValue } = body

    const job = await prisma.job.update({
      where: { id: params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(status !== undefined && { status }),
        ...(productionType !== undefined && { productionType }),
        ...(agentId !== undefined && { agentId }),
        ...(notes !== undefined && { notes }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
        ...(estimatedValue !== undefined && {
          estimatedValue:
            estimatedValue == null || estimatedValue === '' ? null : Number(estimatedValue),
        }),
      },
    })

    return NextResponse.json({
      job: {
        ...job,
        estimatedValue: job.estimatedValue == null ? null : Number(job.estimatedValue),
      },
    })
  } catch (error) {
    console.error(`PATCH /api/jobs/${params.id} error:`, error)
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 })
  }
}
