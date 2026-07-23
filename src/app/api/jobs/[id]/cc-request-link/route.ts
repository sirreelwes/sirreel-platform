import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * POST /api/jobs/[id]/cc-request-link — authed.
 *
 * Returns the client-facing portal link where the client authorizes a
 * credit card (the existing Portal v2 CcAuthCard flow, keyed by a
 * PaperworkRequest token). Staff copy it and send it to the client.
 *
 * The card auth lives on paperwork_requests, which is booking-scoped, so
 * we resolve the job's most recent active booking and reuse its
 * PaperworkRequest (minting one if none exists yet). 409 when the job has
 * no booking to hang the request on — nothing to authorize against yet.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const job = await prisma.job.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      jobContacts: { include: { person: true }, orderBy: [{ isPrimary: 'desc' }, { role: 'asc' }] },
      bookings: {
        where: { status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      },
    },
  })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const booking = job.bookings[0]
  if (!booking) {
    return NextResponse.json(
      { error: 'No booking on this job yet — add a reservation before requesting a card.' },
      { status: 409 },
    )
  }

  // Reuse the booking's PaperworkRequest if present; otherwise mint one.
  let pr = await prisma.paperworkRequest.findFirst({
    where: { bookingId: booking.id },
    orderBy: { sentAt: 'desc' },
    select: { token: true },
  })
  if (!pr) {
    const primary = job.jobContacts.find((c) => c.isPrimary) ?? job.jobContacts[0]
    const sentTo = primary?.person?.email || ''
    pr = await prisma.paperworkRequest.create({
      data: { bookingId: booking.id, sentTo },
      select: { token: true },
    })
  }

  const origin = _req.nextUrl.origin
  return NextResponse.json({ url: `${origin}/portal/v2/${pr.token}`, token: pr.token })
}
