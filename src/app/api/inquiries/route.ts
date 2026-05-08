import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import type { InquiryStatus, InquirySource } from '@prisma/client'

export const dynamic = 'force-dynamic'

// GET /api/inquiries?status=NEW (default) | ALL
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const filter = (searchParams.get('status') || 'OPEN').toUpperCase()

  const where =
    filter === 'ALL'
      ? {}
      : { status: 'NEW' as InquiryStatus }

  const inquiries = await prisma.inquiry.findMany({
    where,
    include: {
      company: { select: { id: true, name: true } },
      person: { select: { id: true, firstName: true, lastName: true, email: true } },
      assignedTo: { select: { id: true, name: true } },
      convertedJob: { select: { id: true, jobCode: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return NextResponse.json({
    inquiries: inquiries.map((i) => ({
      ...i,
      estimatedValue: i.estimatedValue == null ? null : Number(i.estimatedValue),
    })),
  })
}

// POST /api/inquiries
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      title,
      description,
      companyId,
      personId,
      estimatedValue,
      preferredStartDate,
      preferredEndDate,
      source,
      sourceMetadata,
    } = body
    let { assignedToId } = body

    if (!title || !description) {
      return NextResponse.json({ error: 'title and description are required' }, { status: 400 })
    }

    // Default assignedTo to the logged-in user
    if (!assignedToId) {
      const session = await getServerSession()
      if (session?.user?.email) {
        const user = await prisma.user.findUnique({
          where: { email: session.user.email },
          select: { id: true },
        })
        if (user) assignedToId = user.id
      }
    }

    const inquiry = await prisma.inquiry.create({
      data: {
        title,
        description,
        source: (source as InquirySource) || 'MANUAL',
        companyId: companyId || null,
        personId: personId || null,
        estimatedValue:
          estimatedValue == null || estimatedValue === '' ? null : Number(estimatedValue),
        preferredStartDate: preferredStartDate ? new Date(preferredStartDate) : null,
        preferredEndDate: preferredEndDate ? new Date(preferredEndDate) : null,
        assignedToId: assignedToId || null,
        sourceMetadata: sourceMetadata || null,
      },
      include: {
        company: { select: { id: true, name: true } },
        person: { select: { id: true, firstName: true, lastName: true, email: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json(
      {
        inquiry: {
          ...inquiry,
          estimatedValue: inquiry.estimatedValue == null ? null : Number(inquiry.estimatedValue),
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('POST /api/inquiries error:', error)
    return NextResponse.json({ error: 'Failed to create inquiry' }, { status: 500 })
  }
}
