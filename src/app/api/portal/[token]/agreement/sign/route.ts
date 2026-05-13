import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { resolveAgreementToken } from '@/lib/portal/agreementToken'
import { ensureSignedAgreementForOrder } from '@/lib/orders/signedAgreement'
import { generateSignedAgreementPdf } from '@/lib/contracts/generateSignedAgreementPdf'
import { sendAgreementEmail, type EmailResult } from '@/lib/email/sendAgreementEmail'
import type { AgreementStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const PDF_MIME = 'application/pdf'
const COPY_RECIPIENTS = {
  sales: ['jose@sirreel.com', 'oliver@sirreel.com'],
  billing: ['ana@sirreel.com'],
}

interface SignRequestBody {
  signerName?: unknown
  signerTitle?: unknown
  signerEmail?: unknown
  signatureImageData?: unknown
  acknowledgmentText?: unknown
  acknowledged?: unknown
}

interface ValidatedSignBody {
  signerName: string
  signerTitle: string
  signerEmail: string
  signatureImageData: string
  acknowledgmentText: string
}

function trimString(value: unknown, max = 200): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

function validateBody(raw: SignRequestBody): { ok: true; data: ValidatedSignBody } | { ok: false; error: string } {
  if (raw.acknowledged !== true) {
    return { ok: false, error: 'Acknowledgment checkbox must be confirmed.' }
  }
  const signerName = trimString(raw.signerName, 120)
  const signerTitle = trimString(raw.signerTitle, 120)
  const signerEmail = trimString(raw.signerEmail, 160)
  const signatureImageData = typeof raw.signatureImageData === 'string' ? raw.signatureImageData : ''
  const acknowledgmentText = trimString(raw.acknowledgmentText, 1200)
  if (!signerName) return { ok: false, error: 'Signer name is required.' }
  if (!signerTitle) return { ok: false, error: 'Signer title is required.' }
  if (!signerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) {
    return { ok: false, error: 'Valid signer email is required.' }
  }
  if (!signatureImageData.startsWith('data:image/')) {
    return { ok: false, error: 'Signature image is required.' }
  }
  if (!acknowledgmentText) {
    return { ok: false, error: 'Acknowledgment text is required.' }
  }
  return {
    ok: true,
    data: { signerName, signerTitle, signerEmail, signatureImageData, acknowledgmentText },
  }
}

function clientIpFrom(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]!.trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  return null
}

function signedStatusFor(documentType: 'BASELINE' | 'NEGOTIATED'): AgreementStatus {
  return documentType === 'NEGOTIATED' ? 'SIGNED_NEGOTIATED' : 'SIGNED_BASELINE'
}

function isSignableStatus(status: AgreementStatus, documentType: 'BASELINE' | 'NEGOTIATED'): boolean {
  if (documentType === 'NEGOTIATED') return status === 'NEGOTIATED_READY'
  return status === 'PORTAL_GENERATED' || status === 'DOWNLOAD_SENT'
}

async function sendSignedCopies(args: {
  companyName: string
  jobName: string
  signerName: string
  signerEmail: string
  documentType: 'BASELINE' | 'NEGOTIATED'
  pdfBuffer: Buffer
  attachmentName: string
}): Promise<EmailResult> {
  const subjectLabel = args.documentType === 'NEGOTIATED' ? 'negotiated agreement' : 'rental agreement'
  const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#f9fafb;margin:0;padding:20px;">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#1f3d5c;padding:20px;text-align:center;">
      <div style="color:white;font-size:18px;font-weight:bold;">SirReel HQ</div>
      <div style="color:#bfd7ff;font-size:12px;margin-top:4px;">Signed ${subjectLabel}</div>
    </div>
    <div style="padding:20px;color:#374151;font-size:14px;line-height:1.5;">
      <p>The ${subjectLabel} for <strong>${args.companyName}</strong> has been signed.</p>
      <table style="width:100%;border-collapse:collapse;margin:12px 0;">
        <tr><td style="padding:4px 0;color:#6b7280;width:120px;">Job</td><td style="padding:4px 0;font-weight:600;">${args.jobName || '—'}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Signer</td><td style="padding:4px 0;font-weight:600;">${args.signerName}</td></tr>
      </table>
      <p style="font-size:13px;color:#6b7280;">The signed PDF is attached to this email.</p>
    </div>
    <div style="padding:14px 20px;background:#f9fafb;text-align:center;font-size:11px;color:#9ca3af;">
      SirReel Studio Services &middot; (888) 477-7335
    </div>
  </div>
</body></html>`
  return sendAgreementEmail({
    label: 'portal/agreement/sign',
    to: [args.signerEmail],
    cc: [...COPY_RECIPIENTS.sales, ...COPY_RECIPIENTS.billing],
    subject: `Signed: ${args.companyName} · ${subjectLabel}`,
    html,
    attachments: [{ filename: args.attachmentName, content: args.pdfBuffer }],
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
    where: { orderId: resolved.order.id },
    select: { id: true, status: true, documentType: true },
  })
  if (!agreement) {
    return NextResponse.json({ error: 'Agreement not initialized' }, { status: 500 })
  }

  if (!isSignableStatus(agreement.status, agreement.documentType)) {
    return NextResponse.json(
      {
        error: 'Agreement is not in a signable state',
        currentStatus: agreement.status,
      },
      { status: 409 },
    )
  }

  const raw = (await req.json().catch(() => ({}))) as SignRequestBody
  const validation = validateBody(raw)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }
  const body = validation.data

  const orderRow = await prisma.order.findUnique({
    where: { id: resolved.order.id },
    select: {
      id: true,
      orderNumber: true,
      company: { select: { name: true, billingAddress: true } },
      job: { select: { jobCode: true, name: true, startDate: true, endDate: true } },
      bookingId: true,
    },
  })
  if (!orderRow || !orderRow.company) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const ip = clientIpFrom(req)
  const ua = req.headers.get('user-agent') || null
  const signedAt = new Date()

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await generateSignedAgreementPdf({
      company: { name: orderRow.company.name, billingAddress: orderRow.company.billingAddress },
      job: {
        jobCode: orderRow.job?.jobCode || null,
        name: orderRow.job?.name || null,
        startDate: orderRow.job?.startDate || null,
        endDate: orderRow.job?.endDate || null,
      },
      signature: {
        signerName: body.signerName,
        signerTitle: body.signerTitle,
        signerEmail: body.signerEmail,
        signatureImageDataUri: body.signatureImageData,
        acknowledgmentText: body.acknowledgmentText,
        signedAt,
        ipAddress: ip,
        userAgent: ua,
      },
      documentLabel: agreement.documentType === 'NEGOTIATED' ? 'negotiated' : 'baseline',
    })
  } catch (err) {
    console.error('[portal/agreement/sign] PDF render failed:', err)
    return NextResponse.json({ error: 'Failed to generate signed PDF' }, { status: 500 })
  }

  const variant = agreement.documentType === 'NEGOTIATED' ? 'negotiated' : 'baseline'
  const blobKey = `signed-agreements/${orderRow.id}/${variant}-${signedAt.getTime()}.pdf`

  let blobUrl: string | null = null
  try {
    const uploaded = await put(blobKey, pdfBuffer, { access: 'private', contentType: PDF_MIME })
    blobUrl = uploaded.url
  } catch (err) {
    console.error('[portal/agreement/sign] blob upload failed:', err)
    return NextResponse.json({ error: 'Failed to save signed PDF' }, { status: 500 })
  }

  await prisma.signedAgreement.update({
    where: { id: agreement.id },
    data: {
      status: signedStatusFor(agreement.documentType),
      signedAt,
      signerName: body.signerName,
      signerTitle: body.signerTitle,
      signerEmail: body.signerEmail,
      signatureImageData: body.signatureImageData,
      acknowledgmentText: body.acknowledgmentText,
      signerIpAddress: ip,
      signerUserAgent: ua,
      signedDocumentUrl: blobUrl,
    },
  })

  // Keep the legacy paperwork checklist in sync — the existing portal page's
  // "Rental agreement done" badge is driven off these fields.
  try {
    await prisma.paperworkRequest.update({
      where: { token: params.token },
      data: { rentalAgreement: true, signerName: body.signerName },
    })
    await prisma.booking.update({
      where: { id: resolved.bookingId },
      data: { rentalAgreement: true },
    })
  } catch (err) {
    console.warn('[portal/agreement/sign] legacy paperwork sync failed:', err)
  }

  const emailResult = await sendSignedCopies({
    companyName: orderRow.company.name,
    jobName: orderRow.job?.name || '',
    signerName: body.signerName,
    signerEmail: body.signerEmail,
    documentType: agreement.documentType === 'NEGOTIATED' ? 'NEGOTIATED' : 'BASELINE',
    pdfBuffer,
    attachmentName: `sirreel-rental-agreement-${orderRow.job?.jobCode || orderRow.orderNumber}.pdf`,
  })

  return NextResponse.json({
    ok: true,
    status: signedStatusFor(agreement.documentType),
    signedAt: signedAt.toISOString(),
    signerName: body.signerName,
    signedDocumentAvailable: !!blobUrl,
    emailResult,
  })
}
