import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import type { InquiryStatus } from '@prisma/client'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const inquiry = await prisma.inquiry.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      person: { select: { id: true, firstName: true, lastName: true, email: true } },
      assignedTo: { select: { id: true, name: true } },
      convertedJob: { select: { id: true, jobCode: true, name: true } },
    },
  })
  if (!inquiry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({
    inquiry: {
      ...inquiry,
      estimatedValue: inquiry.estimatedValue == null ? null : Number(inquiry.estimatedValue),
    },
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  try {
    const body = await req.json()
    const data: Record<string, unknown> = {}
    if (body.status !== undefined) data.status = body.status as InquiryStatus
    if (body.title !== undefined) data.title = body.title
    if (body.description !== undefined) data.description = body.description
    if (body.companyId !== undefined) data.companyId = body.companyId || null
    if (body.personId !== undefined) data.personId = body.personId || null
    if (body.assignedToId !== undefined) data.assignedToId = body.assignedToId || null
    // `assignToMe: true` — resolve the logged-in user server-side so
    // the triage UI doesn't need to know its own user.id. Wins over
    // assignedToId if both are passed.
    if (body.assignToMe === true) {
      const session = await getServerSession()
      if (!session?.user?.email) {
        return NextResponse.json({ error: 'not signed in' }, { status: 401 })
      }
      const me = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true },
      })
      if (!me) {
        return NextResponse.json({ error: 'session user not found' }, { status: 401 })
      }
      data.assignedToId = me.id
    }
    if (body.estimatedValue !== undefined) {
      data.estimatedValue =
        body.estimatedValue == null || body.estimatedValue === ''
          ? null
          : Number(body.estimatedValue)
    }
    if (body.preferredStartDate !== undefined) {
      data.preferredStartDate = body.preferredStartDate ? new Date(body.preferredStartDate) : null
    }
    if (body.preferredEndDate !== undefined) {
      data.preferredEndDate = body.preferredEndDate ? new Date(body.preferredEndDate) : null
    }
    if (body.convertedJobId !== undefined) data.convertedJobId = body.convertedJobId || null

    const inquiry = await prisma.inquiry.update({
      where: { id },
      data,
      include: {
        company: { select: { id: true, name: true } },
        person: { select: { id: true, firstName: true, lastName: true, email: true } },
        assignedTo: { select: { id: true, name: true } },
        convertedJob: { select: { id: true, jobCode: true, name: true } },
      },
    })

    return NextResponse.json({
      inquiry: {
        ...inquiry,
        estimatedValue: inquiry.estimatedValue == null ? null : Number(inquiry.estimatedValue),
      },
    })
  } catch (error) {
    console.error(`PATCH /api/inquiries/${id} error:`, error)
    return NextResponse.json({ error: 'Failed to update inquiry' }, { status: 500 })
  }
}
