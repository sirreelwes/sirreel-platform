import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * POST /api/jobs/[id]/unmark-returned — undo mark-returned.
 *
 * Nulls returnedAt + returnedById; the card reverts to its derived
 * board column (usually OUT with the overdue treatment). Idempotent —
 * unmarking an already-unmarked job is a no-op success.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id || null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const job = await prisma.job.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 })

  await prisma.job.update({
    where: { id: job.id },
    data: { returnedAt: null, returnedById: null },
  })
  return NextResponse.json({ ok: true })
}
