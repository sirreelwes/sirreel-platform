import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { adoptJobPaperworkRequest } from '@/lib/paperwork/livePaperworkBooking'
import { ensureJobPaperworkBooking } from '@/lib/paperwork/ensurePaperworkBooking'

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
 * PaperworkRequest (minting one if none exists yet). A job with no
 * booking gets one created off its order (Wes 2026-09-05: a CCA is start
 * paperwork and goes out as soon as the job exists).
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
    },
  })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  // A job is enough to ask for a card (Wes 2026-09-05) — create the
  // booking the link hangs off when the job has none.
  const ensured = await ensureJobPaperworkBooking(job.id)
  if (!ensured.ok) return NextResponse.json({ error: ensured.error }, { status: 409 })
  const booking = { id: ensured.bookingId }

  // Reuse the JOB's PaperworkRequest if present; otherwise mint one.
  // Job-scoped so a rebook (cancel the hold, create the reservation)
  // doesn't hand the client a second token while the one they already
  // have points at the retired booking.
  let pr: { token: string } | null = await adoptJobPaperworkRequest(job.id, booking.id)
  if (!pr) {
    const primary = job.jobContacts.find((c) => c.isPrimary) ?? job.jobContacts[0]
    const sentTo = primary?.person?.email || ''
    pr = await prisma.paperworkRequest.create({
      data: { bookingId: booking.id, sentTo },
      select: { token: true },
    })
  } else {
    // HQ is handing this link out now, so it stops being the client's own
    // head start and starts gating the yard like any other CCA ask
    // (schema: PaperworkRequest.clientInitiatedAt; lib/payments/cardGate.ts).
    await prisma.paperworkRequest
      .updateMany({ where: { token: pr.token, clientInitiatedAt: { not: null } }, data: { clientInitiatedAt: null } })
      .catch(() => null)
  }

  const origin = _req.nextUrl.origin
  return NextResponse.json({ url: `${origin}/portal/v2/${pr.token}`, token: pr.token })
}
