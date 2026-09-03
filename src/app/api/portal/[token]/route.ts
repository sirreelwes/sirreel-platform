import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const request = await prisma.paperworkRequest.findUnique({
      where: { token: params.token },
      include: {
        booking: {
          include: {
            company: true,
            person: true,
            agent: true,
            items: { include: { category: true } },
            // Client-facing: the after-hours job code lives on the Job and
            // is meant to be shown to the client on their portal. Narrow
            // select — never widen to asset internals.
            job: { select: { assistantAuthCode: true, jobCode: true, name: true } }
          }
        }
      }
    })
    if (!request) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })

    // Resolve the headline HERE rather than at each of the page's four
    // render sites. `jobName` is what the whole client portal prints as
    // the title of the production, and an unnamed Planyo import used to
    // put our cart id in front of the client (Wes, 2026-09-03). The
    // resolver prefers the name a human edits in HQ, then Planyo's, then
    // the company — never a placeholder, never blank.
    const booking = {
      ...request.booking,
      jobName: resolveDisplayJobName({
        jobName: request.booking?.job?.name,
        bookingJobName: request.booking?.jobName,
        companyName: request.booking?.company?.name,
      }),
    }
    return NextResponse.json({ booking, request })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
