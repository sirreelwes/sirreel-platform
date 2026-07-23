import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * POST /api/jobs/[id]/archive        → soft-archive (sets archivedAt = now)
 * POST /api/jobs/[id]/archive?undo=1 → unarchive (clears archivedAt)
 *
 * Visibility-only. Additive `sr_jobs.archived_at` column; the detail page
 * stays reachable, the /jobs list hides archived by default. Idempotent.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const undo = req.nextUrl.searchParams.get('undo') === '1'

  const existing = await prisma.job.findUnique({
    where: { id: params.id },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const job = await prisma.job.update({
    where: { id: params.id },
    data: { archivedAt: undo ? null : new Date() },
    select: { id: true, archivedAt: true },
  })
  return NextResponse.json({ ok: true, archivedAt: job.archivedAt })
}
