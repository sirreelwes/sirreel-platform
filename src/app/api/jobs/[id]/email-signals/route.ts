import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/jobs/[id]/email-signals — the change-of-plan suggestions raised
 * from client email on this job (src/lib/email/jobChangeSignals.ts).
 * OPEN ones first, then the last few resolved so the card can say "you
 * already dismissed this one on Tuesday". Read-only.
 *
 * Fail-soft until `prisma db push` lands the table: an empty list, not a
 * 500, so the job page never breaks on a missing suggestion feature.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const { id } = await params

  const rows = await prisma.jobEmailSignal
    .findMany({
      where: { jobId: id },
      select: {
        id: true,
        kind: true,
        status: true,
        evidence: true,
        linkedBy: true,
        summary: true,
        resolvedAt: true,
        resolutionNote: true,
        createdAt: true,
        message: {
          select: { id: true, threadId: true, fromAddress: true, subject: true, sentAt: true, snippet: true },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 20,
    })
    .catch(() => [])

  const open = rows.filter((r) => r.status === 'OPEN')
  const resolved = rows.filter((r) => r.status !== 'OPEN').slice(0, 5)
  return NextResponse.json({ open, resolved })
}
