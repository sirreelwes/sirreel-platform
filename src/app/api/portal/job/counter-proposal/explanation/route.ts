/**
 * GET /api/portal/job/counter-proposal/explanation — "Why we landed here",
 * the tactful clause-by-clause walk-through beside the counter-proposal on
 * the client's job portal (Wes 2026-09-15).
 *
 * Same gate and same review lookup as the PDF route beside it, so the
 * explanation always describes the PDF the client can open. Written on the
 * first read after a (re)generated counter-PDF and stored — see
 * lib/contracts/counterExplanation for what the writer is and is not shown.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveJobPortalRead } from '@/lib/portal/jobPreview'
import { latestCounterProposalForJob } from '@/lib/contracts/jobCounterProposal'
import { getCounterExplanation } from '@/lib/contracts/counterExplanation'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const read = await resolveJobPortalRead(req)
  if (!read) return NextResponse.json({ error: 'No session' }, { status: 401 })
  const resolved = read.resolved
  if (!resolved) return NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })

  const order = await prisma.order.findUnique({ where: { id: resolved.orderId }, select: { jobId: true } })
  if (!order?.jobId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const review = await latestCounterProposalForJob(order.jobId)
  if (!review) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const explanation = await getCounterExplanation(review.id, { generate: true })
  if (!explanation) return NextResponse.json({ error: 'Not available' }, { status: 404 })
  return NextResponse.json(
    { ok: true, explanation },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
