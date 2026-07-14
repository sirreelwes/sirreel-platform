import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const PHASES = new Set(['PREJOB', 'OUT', 'RETURNED'])

/**
 * POST /api/jobs/[id]/board-phase — manual kanban placement.
 *
 * Body: { phase: 'PREJOB' | 'OUT' | 'RETURNED' | null }. Non-null
 * upserts the side-table override; null clears it (card reverts to the
 * date/cadence-derived column). PRESENTATION ONLY — never touches
 * Job.status or any Booking. This is the interim stand-in until real
 * checkout/check-in events exist; those triggers will replace writes
 * to sr_job_board_overrides and the table gets dropped.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const phase = body.phase === null ? null : typeof body.phase === 'string' ? body.phase : undefined
  if (phase === undefined || (phase !== null && !PHASES.has(phase))) {
    return NextResponse.json({ error: "phase must be 'PREJOB' | 'OUT' | 'RETURNED' | null" }, { status: 400 })
  }

  const job = await prisma.job.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 })

  if (phase === null) {
    await prisma.jobBoardOverride.deleteMany({ where: { jobId: job.id } })
    return NextResponse.json({ ok: true, phase: null })
  }
  await prisma.jobBoardOverride.upsert({
    where: { jobId: job.id },
    create: { jobId: job.id, phase, movedBy: session.user.email },
    update: { phase, movedBy: session.user.email, movedAt: new Date() },
  })
  return NextResponse.json({ ok: true, phase })
}
