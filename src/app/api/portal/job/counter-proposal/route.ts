/**
 * GET /api/portal/job/counter-proposal — SirReel's counter-proposal to the
 * client's redline, for the job portal's paperwork list (Wes 2026-09-15:
 * the generated PDF "should be sent to the portal").
 *
 * Gated by the job session like the quote and agreement proxies beside it;
 * the raw blob URL is private and never handed to a browser. The review is
 * found by the session order's JOB, so a client only ever reaches their own
 * production's document. A staff preview may read it — this is a read route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveJobPortalRead } from '@/lib/portal/jobPreview'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'
import { counterProposalFilename, latestCounterProposalForJob } from '@/lib/contracts/jobCounterProposal'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const read = await resolveJobPortalRead(req)
  if (!read) return NextResponse.json({ error: 'No session' }, { status: 401 })
  const resolved = read.resolved
  if (!resolved) return NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })

  const order = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: { jobId: true, job: { select: { jobCode: true } } },
  })
  if (!order?.jobId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const review = await latestCounterProposalForJob(order.jobId)
  if (!review?.counterPdfUrl) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const res = await streamPrivateBlobAsResponse({
    fileUrl: review.counterPdfUrl,
    filename: counterProposalFilename(order.job?.jobCode),
    forceDownload: req.nextUrl.searchParams.get('download') === '1',
  })
  res.headers.set('Cache-Control', 'private, no-store')
  return res
}
