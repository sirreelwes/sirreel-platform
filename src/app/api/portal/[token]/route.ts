import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'
import { healPaperworkRequestBooking } from '@/lib/paperwork/livePaperworkBooking'

const bookingInclude = {
  company: true,
  person: true,
  agent: true,
  items: { include: { category: true } },
  // Client-facing: the after-hours job code lives on the Job and
  // is meant to be shown to the client on their portal. Narrow
  // select — never widen to asset internals.
  job: { select: { assistantAuthCode: true, jobCode: true, name: true } },
} as const

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const request = await prisma.paperworkRequest.findUnique({
      where: { token: params.token },
      include: { booking: { include: bookingInclude } },
    })
    if (!request) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })

    // A rebooked job retires the booking this link was minted against —
    // routinely within minutes of the link being emailed. Follow the
    // request onto the job's live booking rather than serving the client
    // a locked, read-only portal for a rental that is still going out.
    // See src/lib/paperwork/livePaperworkBooking.ts.
    const liveBookingId = await healPaperworkRequestBooking({
      id: request.id,
      bookingId: request.bookingId,
      booking: request.booking,
    })
    const source =
      liveBookingId === request.bookingId
        ? request.booking
        : await prisma.booking.findUnique({
            where: { id: liveBookingId },
            include: bookingInclude,
          })

    // Resolve the headline HERE rather than at each of the page's four
    // render sites. `jobName` is what the whole client portal prints as
    // the title of the production, and an unnamed Planyo import used to
    // put our cart id in front of the client (Wes, 2026-09-03). The
    // resolver prefers the name a human edits in HQ, then Planyo's, then
    // the company — never a placeholder, never blank.
    const booking = {
      ...source,
      jobName: resolveDisplayJobName({
        jobName: source?.job?.name,
        bookingJobName: source?.jobName,
        companyName: source?.company?.name,
      }),
    }
    // `request.booking` has always mirrored the top-level booking; keep
    // that true after a heal rather than shipping two different bookings
    // in one payload.
    return NextResponse.json({
      booking,
      request: { ...request, bookingId: liveBookingId, booking: source },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
