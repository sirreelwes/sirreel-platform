import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { put } from '@vercel/blob'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { runContractReviewAi } from '@/lib/contracts/runReview'

export async function POST(req: NextRequest) {
  try {
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

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const companyName = (formData.get('companyName') as string) || ''
    const jobId = (formData.get('jobId') as string) || null
    const companyId = (formData.get('companyId') as string) || null
    const secondRoundClausesRaw = (formData.get('secondRoundClauses') as string) || ''
    let secondRoundClauses: string[] = []
    if (secondRoundClausesRaw) {
      try {
        const parsed = JSON.parse(secondRoundClausesRaw)
        if (Array.isArray(parsed)) {
          secondRoundClauses = parsed.map((s) => String(s).trim()).filter(Boolean)
        }
      } catch {
        // Invalid JSON — treat as no second-round flags
      }
    }
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const uploadedBase64 = Buffer.from(bytes).toString('base64')
    const isPdf = file.type === 'application/pdf'

    if (!isPdf) {
      return NextResponse.json({
        ok: true,
        review: {
          summary: 'Word document received — please convert to PDF.',
          riskLevel: 'medium',
          autoApprovedCount: 0,
          needsReviewCount: 1,
          notAcceptableCount: 0,
          changes: [{
            clause: 'All clauses',
            type: 'needs_review',
            description: 'Client redlined Word document (tracked changes not visible to AI)',
            original: 'SirReel rental agreement',
            proposed: null,
            reasoning: 'Word tracked changes are not preserved when sent to vision API.',
            suggestedCounter: null,
            counterReasoning: 'Open in Word, accept-or-reject all tracked changes to flatten them, then export to PDF and re-upload.',
            playbookSource: 'not_covered',
            needsOperatorReview: true,
            operatorReviewReason: 'Word tracked changes are not readable by the AI; operator must convert and re-upload before review.',
          }],
          recommendation: 'counter',
          recommendationNote: 'Convert the Word file to PDF and re-upload.',
          comparisonPerformed: false,
          comparisonNote: 'Cannot read Word tracked changes via vision API.'
        }
      })
    }

    const now = new Date()
    const yyyy = now.getUTCFullYear()
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
    const blobKey = `contracts/${yyyy}/${mm}/${randomUUID()}.pdf`
    const blob = await put(blobKey, file, {
      access: 'private',
      contentType: 'application/pdf',
    })

    const result = await runContractReviewAi({
      uploadedBase64,
      companyName,
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
      }
    }

    const reviewRecord = await prisma.contractReview.create({
      data: {
        fileKey: blobKey,
        fileUrl: blob.url,
        originalFilename: file.name,
        fileSize: file.size,
        mimeType: file.type,
        jobId,
        companyId,
        uploadedById: sessionUser.id,
        aiResponse: review,
        aiRiskLevel: typeof review.riskLevel === 'string' ? review.riskLevel : null,
        aiRecommendation:
          typeof review.recommendation === 'string' ? review.recommendation : null,
      },
      select: { id: true },
    })

    return NextResponse.json({ ok: true, review, reviewRecordId: reviewRecord.id })
  } catch (err: any) {
    console.error('[contract-review]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
