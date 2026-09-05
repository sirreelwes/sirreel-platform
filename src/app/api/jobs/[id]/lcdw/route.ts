/**
 * POST /api/jobs/[id]/lcdw — record the client's damage-waiver election on
 *      their behalf (they told a rep on the phone, or emailed it).
 * PUT  /api/jobs/[id]/lcdw — re-cut the job addendum from the election
 *      already on file.
 *
 * The re-cut exists because the addendum render is best-effort at election
 * time: a client's answer is never lost to a PDF failure, which means there
 * has to be a way to produce the PDF afterwards. It is also the right button
 * after the job is renamed or its orders change — the addendum prints the job
 * name and the covered vehicles, and a stale one in the job file is worse
 * than none.
 *
 * Recording on behalf writes source=STAFF and stamps who did it. The
 * addendum then prints the client's name as the signer with the
 * acknowledgement text — which is honest only because a rep is attesting that
 * the client said it. That attestation is the audit row.
 *
 * Recording an answer applies it to the job's orders too (2026-09-05):
 * ACCEPTED adds the $24/day fee line to every live order with an eligible
 * vehicle, DECLINED removes it, and any order whose quote the client has
 * already seen gets the "Updated quote" email — the same helper the portal
 * election and the order-page button use, so one place prices it. The
 * re-cut (PUT) still touches no money.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  recordJobLcdwElection,
  fileJobAddendum,
  summarizeJobLcdwCoverage,
} from '@/lib/lcdw/jobElection'
import { applyLcdwElectionToJobOrders } from '@/lib/lcdw/applyElectionToOrders'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function requireUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true },
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const job = await prisma.job.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as {
    decision?: unknown
    signerName?: unknown
    signerTitle?: unknown
    signerEmail?: unknown
  }
  const decision =
    body.decision === 'ACCEPTED' || body.decision === 'DECLINED' ? body.decision : null
  const signerName = typeof body.signerName === 'string' ? body.signerName.trim() : ''
  if (!decision) return NextResponse.json({ error: 'decision is required' }, { status: 400 })
  if (!signerName) {
    // The addendum names a person. Recording "the client accepted" with
    // nobody attached is not a record we could stand behind.
    return NextResponse.json(
      { error: 'Name the person who gave you this answer.' },
      { status: 400 },
    )
  }

  if (decision === 'ACCEPTED') {
    const summary = await summarizeJobLcdwCoverage(job.id)
    if (summary.allExcluded || summary.coveredVehicles.length === 0) {
      return NextResponse.json(
        { error: 'No vehicle on this job is eligible for LCDW — nothing to accept.' },
        { status: 409 },
      )
    }
  }

  const { election, addendumId } = await recordJobLcdwElection({
    jobId: job.id,
    decision,
    signerName,
    signerTitle: typeof body.signerTitle === 'string' ? body.signerTitle.trim() || null : null,
    signerEmail: typeof body.signerEmail === 'string' ? body.signerEmail.trim() || null : null,
    ipAddress: null,
    userAgent: null,
    source: 'STAFF',
    recordedById: user.id,
  })

  let applied: Awaited<ReturnType<typeof applyLcdwElectionToJobOrders>> | null = null
  try {
    applied = await applyLcdwElectionToJobOrders({
      jobId: job.id,
      decision,
      source: 'STAFF',
      recordedById: user.id,
    })
  } catch (err) {
    console.error('[jobs/lcdw] applying the election to orders failed:', err)
  }

  return NextResponse.json({
    ok: true,
    decision: election.decision,
    decidedAt: election.decidedAt,
    addendumFiled: !!addendumId,
    quoteSummary: applied?.summary ?? 'The fee could not be applied automatically — add it on the order.',
  })
}

export async function PUT(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const election = await prisma.lcdwElection.findUnique({
    where: { jobId: params.id },
    select: { id: true },
  })
  if (!election) {
    return NextResponse.json(
      { error: 'No LCDW election on this job yet — there is nothing to put in an addendum.' },
      { status: 409 },
    )
  }

  try {
    const addendumId = await fileJobAddendum(params.id)
    if (!addendumId) {
      return NextResponse.json(
        {
          error:
            'This company has no annual agreement set to auto-cover its jobs, so there is no master to add an addendum to.',
        },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: true, addendumId })
  } catch (err) {
    console.error('[lcdw] manual addendum re-cut failed', params.id, err)
    return NextResponse.json({ error: 'Could not generate the addendum.' }, { status: 500 })
  }
}
