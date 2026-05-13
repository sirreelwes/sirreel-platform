import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { get } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { runContractReviewAi } from '@/lib/contracts/runReview'

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

  const record = await prisma.contractReview.findFirst({
    where: { id: params.id, deletedAt: null },
    include: {
      company: { select: { name: true } },
    },
  })
  if (!record) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!record.fileKey) {
    return NextResponse.json(
      { error: 'Original file no longer available (retention cleanup) — cannot re-run.' },
      { status: 410 },
    )
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const rawClauses = Array.isArray(body.secondRoundClauses) ? body.secondRoundClauses : []
  const secondRoundClauses = rawClauses.map((s: unknown) => String(s).trim()).filter(Boolean)

  let uploadedBase64: string
  try {
    const blob = await get(record.fileKey, { access: 'private' })
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json({ error: 'Original file not retrievable' }, { status: 502 })
    }
    const chunks: Buffer[] = []
    const reader = blob.stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(Buffer.from(value))
    }
    uploadedBase64 = Buffer.concat(chunks).toString('base64')
  } catch (err) {
    console.error('[contract-review][rerun] failed to fetch blob:', err)
    return NextResponse.json({ error: 'Failed to load original file' }, { status: 500 })
  }

  const result = await runContractReviewAi({
    uploadedBase64,
    companyName: record.company?.name || '',
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

  const review = result.review
  if (review && typeof review === 'object') {
    review._meta = {
      ...(review._meta || {}),
      secondRoundClauses,
      rerunAt: new Date().toISOString(),
      rerunById: sessionUser.id,
    }
  }

  await prisma.contractReview.update({
    where: { id: params.id },
    data: {
      aiResponse: review,
      aiRiskLevel: typeof review.riskLevel === 'string' ? review.riskLevel : null,
      aiRecommendation:
        typeof review.recommendation === 'string' ? review.recommendation : null,
    },
  })

  return NextResponse.json({ ok: true, review })
}
