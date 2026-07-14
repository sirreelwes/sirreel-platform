import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * POST /api/jobs/[id]/mark-returned — "the gear is physically back."
 *
 * Sets Job.returnedAt = now + returnedById = session user. This is the
 * manual v1 stand-in for the future warehouse check-in flow, which will
 * write the same field. Semantic, not presentation: billing head-start,
 * inspections, and check-in icons all key off returnedAt. Does NOT touch
 * Job.status — WRAPPED is lifecycle close, a separate axis.
 *
 * 409 when already marked (undo first via unmark-returned).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id || null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const job = await prisma.job.findUnique({
    where: { id: params.id },
    select: { id: true, returnedAt: true },
  })
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 })
  if (job.returnedAt) {
    return NextResponse.json({ error: 'job is already marked returned' }, { status: 409 })
  }

  const updated = await prisma.job.update({
    where: { id: job.id },
    data: { returnedAt: new Date(), returnedById: userId },
    select: { returnedAt: true, returnedBy: { select: { id: true, name: true } } },
  })
  return NextResponse.json({ ok: true, returnedAt: updated.returnedAt, returnedBy: updated.returnedBy })
}
