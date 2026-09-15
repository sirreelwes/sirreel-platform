/**
 * The staff side of "Why we landed here" (Wes 2026-09-15) — see exactly what
 * the client reads beside the counter-proposal, and have it rewritten.
 *
 *   GET  — the stored explanation for the job's current counter-proposal,
 *          written now if there isn't one for this PDF yet.
 *   POST — rewrite it (a fresh pass; replaces the stored one).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { latestCounterProposalForJob } from '@/lib/contracts/jobCounterProposal'
import { getCounterExplanation } from '@/lib/contracts/counterExplanation'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function staff(): Promise<boolean> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return false
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  return !!user
}

async function respond(jobId: string, force: boolean) {
  if (!(await staff())) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const review = await latestCounterProposalForJob(jobId)
  if (!review) return NextResponse.json({ error: 'No counter-proposal on this job.' }, { status: 404 })
  const explanation = await getCounterExplanation(review.id, { generate: true, force })
  if (!explanation) return NextResponse.json({ error: 'Nothing decided to explain yet.' }, { status: 404 })
  return NextResponse.json({ ok: true, reviewId: review.id, explanation })
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return respond(params.id, false)
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  return respond(params.id, true)
}
