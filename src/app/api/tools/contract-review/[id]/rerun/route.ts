import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { rerunContractReview } from '@/lib/contracts/rerunReview'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const rawClauses = Array.isArray(body.secondRoundClauses) ? body.secondRoundClauses : []
  const secondRoundClauses = rawClauses.map((s: unknown) => String(s).trim()).filter(Boolean)

  const result = await rerunContractReview({
    reviewId: params.id,
    rerunById: sessionUser.id,
    secondRoundClauses,
  })

  if (!result.ok) {
    return NextResponse.json(
      result.rawOutput
        ? { error: result.error, rawOutput: result.rawOutput }
        : { error: result.error },
      { status: result.status },
    )
  }

  return NextResponse.json({
    ok: true,
    review: result.review,
    annotationManifest: result.annotationManifest,
  })
}
