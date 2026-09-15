import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { randomUUID } from 'crypto'
import { put, del } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { generateCounterPdf } from '@/lib/contracts/generateCounterPdf'
import { buildReviewPdfProps } from '@/lib/contracts/buildReviewPdfProps'
import { notifyClientOfCounter, type CounterNoticeResult } from '@/lib/contracts/counterNotice'

export const dynamic = 'force-dynamic'
// Render + upload + (first time) the client notice.
export const maxDuration = 60

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

  const built = await buildReviewPdfProps(params.id)
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: built.status })
  }
  const { counterPdfKey: previousCounterKey, reviewId, ...renderProps } = built.props

  let pdfBytes: Buffer
  try {
    pdfBytes = await generateCounterPdf({
      ...renderProps,
      generatedAt: new Date(),
    })
  } catch (err) {
    console.error('[generate-counter-pdf] render error:', err)
    return NextResponse.json(
      { error: 'Failed to render counter-PDF. See server logs.' },
      { status: 500 }
    )
  }

  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const blobKey = `contracts/${yyyy}/${mm}/${randomUUID()}-counter.pdf`

  let blob
  try {
    blob = await put(blobKey, pdfBytes, {
      access: 'private' as any,
      contentType: 'application/pdf',
    })
  } catch (err) {
    console.error('[generate-counter-pdf] blob upload error:', err)
    return NextResponse.json({ error: 'Failed to upload counter-PDF.' }, { status: 500 })
  }

  // Delete the previous counter-PDF, if any (Q4: replace, no versioning).
  const previousKey = previousCounterKey
  await prisma.contractReview.update({
    where: { id: reviewId },
    data: {
      counterPdfKey: blobKey,
      counterPdfUrl: blob.url,
      counterGeneratedAt: now,
      counterGeneratedById: sessionUser.id,
    },
  })

  if (previousKey && previousKey !== blobKey) {
    try {
      await del(previousKey)
    } catch (err) {
      // Non-fatal — orphaned blob will fall out of retention eventually.
      console.warn('[generate-counter-pdf] failed to delete previous blob:', previousKey, err)
    }
  }

  // Posting the counter IS submitting it: the client hears it is in their
  // portal (Wes 2026-09-15). Once per review — a regenerate does not mail
  // them again. `?notify=0` is for callers that send their own email right
  // after (the entered-redline "Approve & send for signature" chain, whose
  // accept step emails "ready to sign" seconds later). Best-effort: a failed
  // notice never fails the PDF, and the desk is told why.
  let notice: CounterNoticeResult | null = null
  if (req.nextUrl.searchParams.get('notify') !== '0') {
    try {
      notice = await notifyClientOfCounter({ reviewId, senderUserId: sessionUser.id })
    } catch (err) {
      console.error('[generate-counter-pdf] client notice failed:', reviewId, err)
      notice = { sent: false, reason: 'The client email failed — use Send to client on the job page.' }
    }
  }

  return NextResponse.json({
    ok: true,
    counterPdfId: reviewId,
    counterGeneratedAt: now.toISOString(),
    notice,
  })
}
