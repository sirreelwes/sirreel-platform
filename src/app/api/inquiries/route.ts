import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { resolveDataScope, inquiryScopeWhere } from '@/lib/auth/scope'
import { prisma } from '@/lib/prisma'
import { resolveInquiriesHandledInHq } from '@/lib/sales/inquiryHandledInHq'
import { readEmailVehicleRequest } from '@/lib/sales/emailVehicleMatch'
import { loadReservableCategories } from '@/lib/sales/reservableCategories'
import { todayPacific } from '@/lib/sales/quoteUrgency'
import { vehicleLineCount } from '@/lib/sales/inquiryVehicleRequest'
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

  // Already an order in HQ? An inquiry answered by a quote (or any other
  // order-linked send) never gets Inquiry.respondedAt stamped — that only
  // fires for a staff message on the inquiry's own email thread, and the
  // quote goes out through Resend on a thread of its own. Derived on read so
  // it can't drift and needs no backfill. See lib/sales/inquiryHandledInHq.
  const handled = await resolveInquiriesHandledInHq(
    inquiries.filter((i) => i.status === 'NEW'),
  )

  // What an EMAIL-born inquiry asked for (Wes 2026-09-11). A web-form
  // request carries a cart and `vehicleLineCount` reads it off the row;
  // a captured email carries prose, and the trucks in it were never
  // read. The AI extraction on the source message already holds them, so
  // resolve it here for the rows the cart can't answer for — same shape,
  // so the card's reserve-first branch covers both streams.
  const emailVehicleRequests = await resolveEmailVehicleRequests(inquiries)

  return NextResponse.json({
    inquiries: inquiries.map((i) => ({
      ...i,
      estimatedValue: i.estimatedValue == null ? null : Number(i.estimatedValue),
      handledInHq: handled.get(i.id) ?? null,
      emailVehicleRequest: emailVehicleRequests.get(i.id) ?? null,
    })),
  })
}

/**
 * inquiryId → the reservation its SOURCE EMAIL asked for, for the rows
 * where that's the only place the ask exists.
 *
 * Skips anything whose stored cart already names vehicles — that path is
 * structured data and beats an extraction every time.
 */
async function resolveEmailVehicleRequests(
  inquiries: Array<{ id: string; sourceMetadata: unknown }>,
): Promise<Map<string, ReturnType<typeof readEmailVehicleRequest>>> {
  const out = new Map<string, ReturnType<typeof readEmailVehicleRequest>>()

  const byEmailId = new Map<string, string[]>()
  for (const i of inquiries) {
    if (vehicleLineCount(i.sourceMetadata) > 0) continue
    const meta = i.sourceMetadata as { emailMessageId?: unknown } | null
    const emailId = typeof meta?.emailMessageId === 'string' ? meta.emailMessageId : null
    if (!emailId) continue
    byEmailId.set(emailId, [...(byEmailId.get(emailId) ?? []), i.id])
  }
  if (byEmailId.size === 0) return out

  const [emails, reservable] = await Promise.all([
    prisma.emailMessage.findMany({
      where: { id: { in: [...byEmailId.keys()] } },
      select: { id: true, extractedData: true, extractionConfidence: true },
    }),
    loadReservableCategories(),
  ])
  const today = todayPacific()

  for (const e of emails) {
    const request = readEmailVehicleRequest(
      e.extractedData,
      e.extractionConfidence,
      reservable,
      today,
    )
    if (!request) continue
    for (const inquiryId of byEmailId.get(e.id) ?? []) out.set(inquiryId, request)
  }
  return out
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
