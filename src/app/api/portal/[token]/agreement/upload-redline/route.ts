import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { put } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { resolveAgreementToken } from '@/lib/portal/agreementToken'
import { ensureSignedAgreementForOrder } from '@/lib/orders/signedAgreement'
import { runContractReviewAi } from '@/lib/contracts/runReview'
import { sendAgreementEmail, type EmailResult } from '@/lib/email/sendAgreementEmail'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

const REVIEW_RECIPIENTS = ['wes@sirreel.com', 'dani@sirreel.com']

const ACCEPTED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

function safeFilenameSegment(s: string | null | undefined, fallback: string): string {
  if (!s) return fallback
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || fallback
}

function blobKeyFor(orderId: string, originalName: string): string {
  const safe = safeFilenameSegment(originalName, 'redline')
  const stamp = Date.now()
  return `redlines/${orderId}/${stamp}-${randomUUID()}-${safe}`
}

function placeholderWordReview() {
  return {
    summary: 'Word document received — operator must convert to PDF and re-run AI review.',
    riskLevel: 'medium',
    autoApprovedCount: 0,
    needsReviewCount: 1,
    notAcceptableCount: 0,
    changes: [
      {
        clause: 'All clauses',
        type: 'needs_review',
        description: 'Client uploaded redline as Word document — tracked changes not readable by AI vision.',
        original: 'SirReel rental agreement',
        proposed: null,
        reasoning: 'Word tracked changes are not preserved when sent to vision API.',
        suggestedCounter: null,
        counterReasoning: 'Open in Word, accept-or-reject all tracked changes to flatten them, then export to PDF and re-upload via the contract review tool.',
        playbookSource: 'not_covered',
        needsOperatorReview: true,
        operatorReviewReason: 'Client redline arrived as .docx — operator must convert to PDF before AI review can run.',
      },
    ],
    recommendation: 'counter',
    recommendationNote: 'Convert the Word file to PDF and re-upload through /tools/contract-review.',
    comparisonPerformed: false,
    comparisonNote: 'Cannot read Word tracked changes via vision API.',
  }
}

async function emailReviewers(args: {
  companyName: string
  jobName: string
  jobCode: string
  reviewId: string
  uploadedFilename: string
}): Promise<EmailResult> {
  const reviewUrl = `https://hq.sirreel.com/tools/contract-review/${args.reviewId}`
  const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#f9fafb;margin:0;padding:20px;">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#1f3d5c;padding:20px;text-align:center;">
      <div style="color:white;font-size:18px;font-weight:bold;">SirReel HQ</div>
      <div style="color:#bfd7ff;font-size:12px;margin-top:4px;">Client redline received</div>
    </div>
    <div style="padding:20px;color:#374151;font-size:14px;line-height:1.5;">
      <p><strong>${args.companyName}</strong> uploaded a redline of the rental agreement.</p>
      <table style="width:100%;border-collapse:collapse;margin:12px 0;">
        <tr><td style="padding:4px 0;color:#6b7280;width:120px;">Job</td><td style="padding:4px 0;font-weight:600;">${args.jobName || '—'}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Job #</td><td style="padding:4px 0;font-weight:600;">${args.jobCode || '—'}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">File</td><td style="padding:4px 0;font-weight:600;">${args.uploadedFilename}</td></tr>
      </table>
      <div style="margin-top:20px;text-align:center;">
        <a href="${reviewUrl}" style="display:inline-block;background:#1f3d5c;color:white;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;">Open contract review &rarr;</a>
      </div>
    </div>
    <div style="padding:14px 20px;background:#f9fafb;text-align:center;font-size:11px;color:#9ca3af;">
      SirReel Studio Services &middot; (888) 477-7335
    </div>
  </div>
</body></html>`
  return sendAgreementEmail({
    label: 'portal/agreement/upload-redline',
    to: REVIEW_RECIPIENTS,
    subject: `Redline received: ${args.companyName} · ${args.jobName || args.jobCode || ''}`,
    html,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  const resolved = await resolveAgreementToken(params.token)
  if (!resolved) {
    return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 })
  }

  if (!resolved.agreement) {
    await ensureSignedAgreementForOrder(resolved.order.id)
  }

  const agreement = await prisma.signedAgreement.findUnique({
    where: { orderId_contractType: { orderId: resolved.order.id, contractType: 'RENTAL_AGREEMENT' } },
    select: { id: true, status: true, contractReviewId: true },
  })
  if (!agreement) {
    return NextResponse.json({ error: 'Agreement not initialized' }, { status: 500 })
  }

  // Allow upload from DOWNLOAD_SENT (typical) or PORTAL_GENERATED (client skipped
  // the download but wants to upload their own draft directly). Reject once we've
  // already taken a redline into review or signed something.
  if (
    agreement.status !== 'PORTAL_GENERATED' &&
    agreement.status !== 'DOWNLOAD_SENT' &&
    agreement.status !== 'REDLINE_UPLOADED'
  ) {
    return NextResponse.json(
      { error: 'Upload not available in current state', currentStatus: agreement.status },
      { status: 409 },
    )
  }

  const formData = await req.formData().catch(() => null)
  const file = formData?.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File exceeds 10 MB limit' }, { status: 413 })
  }
  if (!ACCEPTED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: 'Only .pdf and .docx files are accepted' },
      { status: 415 },
    )
  }

  const orderRow = await prisma.order.findUnique({
    where: { id: resolved.order.id },
    select: {
      id: true,
      orderNumber: true,
      jobId: true,
      companyId: true,
      agentId: true,
      company: { select: { name: true } },
      job: { select: { name: true, jobCode: true } },
    },
  })
  if (!orderRow) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  const blobKey = blobKeyFor(orderRow.id, file.name || 'redline')

  let blobUrl: string
  try {
    const uploaded = await put(blobKey, buffer, { access: 'private', contentType: file.type })
    blobUrl = uploaded.url
  } catch (err) {
    console.error('[portal/agreement/upload-redline] blob upload failed:', err)
    return NextResponse.json({ error: 'Failed to save uploaded file' }, { status: 500 })
  }

  const isPdf = file.type === 'application/pdf'
  let aiResponse: any = placeholderWordReview()
  let aiRiskLevel: string | null = aiResponse.riskLevel
  let aiRecommendation: string | null = aiResponse.recommendation

  if (isPdf) {
    try {
      const result = await runContractReviewAi({
        uploadedBase64: buffer.toString('base64'),
        companyName: orderRow.company?.name || '',
      })
      if (result.ok) {
        aiResponse = result.review
        aiRiskLevel = typeof aiResponse.riskLevel === 'string' ? aiResponse.riskLevel : null
        aiRecommendation = typeof aiResponse.recommendation === 'string' ? aiResponse.recommendation : null
      } else {
        console.error('[portal/agreement/upload-redline] AI review failed:', result.error)
        aiResponse = {
          summary: `Redline received — AI review failed: ${result.error}`,
          riskLevel: 'medium',
          autoApprovedCount: 0,
          needsReviewCount: 1,
          notAcceptableCount: 0,
          changes: [],
          recommendation: 'counter',
          recommendationNote: 'AI review did not complete. Operator can re-run from the contract review UI.',
          comparisonPerformed: false,
          comparisonNote: result.error,
        }
        aiRiskLevel = 'medium'
        aiRecommendation = 'counter'
      }
    } catch (err) {
      console.error('[portal/agreement/upload-redline] AI run threw:', err)
    }
  }

  const review = await prisma.contractReview.create({
    data: {
      fileKey: blobKey,
      fileUrl: blobUrl,
      originalFilename: file.name || 'redline.pdf',
      fileSize: file.size,
      mimeType: file.type,
      jobId: orderRow.jobId,
      companyId: orderRow.companyId,
      uploadedById: orderRow.agentId,
      aiResponse,
      aiRiskLevel,
      aiRecommendation,
    },
    select: { id: true },
  })

  await prisma.signedAgreement.update({
    where: { id: agreement.id },
    data: {
      status: 'REDLINE_UPLOADED',
      redlineUploadUrl: blobUrl,
      contractReviewId: review.id,
    },
  })

  const emailResult = await emailReviewers({
    companyName: orderRow.company?.name || '',
    jobName: orderRow.job?.name || '',
    jobCode: orderRow.job?.jobCode || orderRow.orderNumber,
    reviewId: review.id,
    uploadedFilename: file.name || 'redline',
  })

  return NextResponse.json({
    ok: true,
    status: 'REDLINE_UPLOADED',
    contractReviewId: review.id,
    aiReviewPerformed: isPdf,
    emailResult,
  })
}
