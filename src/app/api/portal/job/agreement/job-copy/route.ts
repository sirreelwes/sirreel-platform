/**
 * GET /api/portal/job/agreement/job-copy — the client downloads ONE document
 * for this job: their master agreement with this job's addendum stapled on.
 *
 * Wes, 2026-09-02: "staple them into one PDF per job." A client's accounting
 * department asking for "the agreement for this job" gets one file, not two
 * attachments and an explanation of how they fit together.
 *
 * Falls back to the addendum alone when the staple failed or predates it —
 * half the document beats none, and the addendum is the half naming the job
 * and carrying the election. Resolves the job from the SESSION, never from a
 * supplied id, so a portal session cannot reach another job's paperwork.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { JOB_SESSION_COOKIE, verifyJobSessionCookieValue } from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'No session' }, { status: 401 })
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) return NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })

  const order = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: { jobId: true },
  })
  if (!order?.jobId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const addendum = await prisma.jobAgreementAddendum.findFirst({
    where: { jobId: order.jobId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    select: {
      combinedFileUrl: true, combinedFilename: true,
      addendumFileUrl: true, addendumFilename: true,
    },
  })
  const fileUrl = addendum?.combinedFileUrl ?? addendum?.addendumFileUrl
  if (!fileUrl) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return streamPrivateBlobAsResponse({
    fileUrl,
    filename: addendum?.combinedFilename ?? addendum?.addendumFilename ?? 'rental-agreement.pdf',
    forceDownload: req.nextUrl.searchParams.get('download') === '1',
  })
}
