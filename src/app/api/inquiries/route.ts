import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { resolveDataScope, inquiryScopeWhere } from '@/lib/auth/scope'
import { prisma } from '@/lib/prisma'
import type { InquiryStatus, InquirySource } from '@prisma/client'

export const dynamic = 'force-dynamic'

// GET /api/inquiries?status=NEW (default) | ALL
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const filter = (searchParams.get('status') || 'OPEN').toUpperCase()

  // Phase 6.5 — data scope enforcement. OWN users see only inquiries
  // assigned to them (unassigned NEW inquiries stay invisible — a
  // privileged user triages and assigns before they show up).
  const scope = await resolveDataScope()
  const scopeWhere = inquiryScopeWhere(scope)

  const where: Record<string, unknown> =
    filter === 'ALL'
      ? { ...scopeWhere }
      : { status: 'NEW' as InquiryStatus, ...scopeWhere }

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

// POST /api/inquiries — internal/agent only.
// Public submission goes through the hardened endpoint:
//   POST /api/public/supply-request   (rate-limited, honeypot,
//                                       captcha-gated, no session)
// This route now REQUIRES a session — historical behavior allowed
// unauthenticated POSTs, which would let anyone seed a NEW inquiry
// with arbitrary attribution. The NewInquiryModal in CRM already
// posts here from inside the dashboard auth shell, so existing
// callers keep working.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

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

    // Default assignedTo to the logged-in user.
    if (!assignedToId) {
      const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true },
      })
      if (user) assignedToId = user.id
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
