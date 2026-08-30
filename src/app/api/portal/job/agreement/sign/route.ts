/**
 * POST /api/portal/job/agreement/sign — native rental countersign.
 *
 * Cookie-auth'd sibling of the legacy /api/portal/[token]/agreement/sign.
 * The legacy endpoint resolves a `PaperworkRequest.token` from the URL;
 * this one resolves the JOB_SESSION_COOKIE (the same cookie powering
 * /api/portal/job/data and /api/portal/job/coi) so the client never
 * leaves the in-portal session.
 *
 * Auth path mirrors /api/portal/[token]/stage-agreement/sign exactly —
 * that route is already cookie-auth'd in practice (the [token] segment
 * is decorative), so the same import + verify + resolve sequence
 * applies here.
 *
 * Permitted source states (PORTAL_RELEASED, NEGOTIATED_READY,
 * DOWNLOAD_SENT) reflect: agreement has been delivered to the client
 * one way or another, and isn't yet signed. PORTAL_GENERATED is
 * rejected — the agent's release-gate must fire first.
 *
 * On success: flips status to SIGNED_BASELINE (or SIGNED_NEGOTIATED
 * if coming from NEGOTIATED_READY), captures signer metadata + IP/UA
 * for the audit trail, and mirrors `signedDocumentUrl` to the
 * existing `documentToSignUrl` as a placeholder until a follow-up
 * commit burns the producer signature into the PDF.
 *
 * Legacy /portal/[token]/agreement/sign untouched per the no-delete
 * directive — both sign endpoints coexist; new clients hit this one.
 */

import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import {
  JOB_SESSION_COOKIE,
  verifyJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { generateSignedAgreementPdf } from '@/lib/contracts/generateSignedAgreementPdf'
import { notifyHqDocument } from '@/lib/email/notifyHqDocument'

export const dynamic = 'force-dynamic'

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')

interface SignBody {
  signerName?: unknown
  signerTitle?: unknown
  signerEmail?: unknown
  acknowledgmentText?: unknown
  signatureImageData?: unknown
}

export async function POST(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) {
    return NextResponse.json({ error: 'No session' }, { status: 401 })
  }
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) {
    return NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as SignBody
  const signerName = typeof body.signerName === 'string' ? body.signerName.trim() : ''
  const acknowledgmentText =
    typeof body.acknowledgmentText === 'string' ? body.acknowledgmentText.trim() : ''
  if (!signerName) return NextResponse.json({ error: 'signerName is required' }, { status: 400 })
  if (!acknowledgmentText)
    return NextResponse.json({ error: 'acknowledgmentText is required' }, { status: 400 })

  const agreement = await prisma.signedAgreement.findUnique({
    where: {
      orderId_contractType: { orderId: resolved.orderId, contractType: 'RENTAL_AGREEMENT' },
    },
    select: { id: true, status: true, documentType: true, documentToSignUrl: true },
  })
  if (!agreement) {
    return NextResponse.json(
      { error: 'No rental agreement has been generated for this order yet' },
      { status: 404 },
    )
  }
  if (!agreement.documentToSignUrl) {
    return NextResponse.json(
      { error: 'Agreement PDF is missing — ask your SirReel rep to regenerate it' },
      { status: 409 },
    )
  }
  if (agreement.status === 'SIGNED_BASELINE' || agreement.status === 'SIGNED_NEGOTIATED') {
    return NextResponse.json({ error: 'Agreement is already signed' }, { status: 409 })
  }
  // Only sign from a released state. PORTAL_GENERATED rejects — the
  // agent's release action must fire first. Mid-negotiation states
  // (REDLINE_UPLOADED, UNDER_REVIEW) also reject — those need to
  // resolve to NEGOTIATED_READY before a counter-sign.
  if (
    agreement.status !== 'PORTAL_RELEASED' &&
    agreement.status !== 'DOWNLOAD_SENT' &&
    agreement.status !== 'NEGOTIATED_READY'
  ) {
    return NextResponse.json(
      {
        error: 'Agreement is not in a signable state',
        currentStatus: agreement.status,
      },
      { status: 409 },
    )
  }

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null
  const ua = req.headers.get('user-agent') || null
  const signedAt = new Date()

  // SIGNED_BASELINE when signing the original baseline PDF (no
  // negotiation), SIGNED_NEGOTIATED when signing the counter-agreed
  // version. The source status carries that distinction.
  const targetStatus =
    agreement.status === 'NEGOTIATED_READY' ? 'SIGNED_NEGOTIATED' : 'SIGNED_BASELINE'
  const documentLabel = targetStatus === 'SIGNED_NEGOTIATED' ? 'negotiated' : 'baseline'

  const signerTitle = typeof body.signerTitle === 'string' ? body.signerTitle.trim() || null : null
  const signerEmail = typeof body.signerEmail === 'string' ? body.signerEmail.trim() || null : null
  const signatureImageData =
    typeof body.signatureImageData === 'string' ? body.signatureImageData : null

  // Render the immutable SIGNED PDF: the approved 29 clauses (same
  // contractClauses.ts source as the review doc, via SignedAgreementDocument)
  // PLUS a signature block showing the client's typed name, date, and e-sign
  // attestation + audit trail. Replaces the prior MVP placeholder that pointed
  // signedDocumentUrl at the UNSIGNED review doc. documentToSignUrl (the
  // pre-sign review copy) is left untouched. A render/upload failure aborts
  // the sign — we never flip to a SIGNED status without a signed artifact, so
  // the client can safely retry.
  const orderForPdf = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: {
      orderNumber: true,
      jobId: true,
      company: { select: { name: true, billingAddress: true } },
      // "Rental period" on the contract is THIS order's window. It used
      // to come off Job.startDate/endDate — a separately-typed job range
      // that drifted from the orders it described, so a signed contract
      // could state dates the order never had.
      startDate: true,
      endDate: true,
      job: { select: { jobCode: true, name: true } },
    },
  })
  const pdfBuffer = await generateSignedAgreementPdf({
    company: orderForPdf?.company ?? null,
    job: orderForPdf?.job
      ? {
          ...orderForPdf.job,
          startDate: orderForPdf.startDate,
          endDate: orderForPdf.endDate,
        }
      : null,
    signature: {
      signerName,
      signerTitle: signerTitle ?? '',
      signerEmail: signerEmail ?? '',
      signatureImageDataUri: signatureImageData ?? '',
      acknowledgmentText,
      signedAt,
      ipAddress: ip,
      userAgent: ua,
    },
    documentLabel,
  })
  const blobKey = `signed-agreements/${resolved.orderId}/${documentLabel}-${signedAt.getTime()}.pdf`
  const uploaded = await put(blobKey, pdfBuffer, { access: 'private', contentType: 'application/pdf' })

  const updated = await prisma.signedAgreement.update({
    where: { id: agreement.id },
    data: {
      status: targetStatus,
      signedAt,
      signerName,
      signerTitle,
      signerEmail,
      signatureImageData,
      acknowledgmentText,
      signerIpAddress: ip,
      signerUserAgent: ua,
      signedDocumentUrl: uploaded.url,
    },
    select: { id: true, status: true, signedAt: true, signedDocumentUrl: true },
  })

  // hq@ gets the signed PDF. This route rendered and filed the agreement
  // and told NOBODY — the native portal is the live client surface, so a
  // countersigned contract could sit unseen until someone opened the job.
  // Fire-and-forget: the signature is already committed above.
  notifyHqDocument({
    kind: 'rental-agreement',
    companyName: orderForPdf?.company?.name ?? null,
    jobName: orderForPdf?.job?.name ?? null,
    rows: [
      { label: 'Job', value: orderForPdf?.job?.name || '—' },
      { label: 'Job code', value: orderForPdf?.job?.jobCode || '—' },
      { label: 'Company', value: orderForPdf?.company?.name || '—' },
      { label: 'Order', value: orderForPdf?.orderNumber || '—' },
      { label: 'Signed by', value: [signerName, signerTitle].filter(Boolean).join(', ') },
      { label: 'Signer email', value: signerEmail || '—' },
      { label: 'Document', value: documentLabel === 'negotiated' ? 'Negotiated agreement' : 'Baseline agreement' },
    ],
    document: {
      filename: `sirreel-rental-agreement-${orderForPdf?.job?.jobCode || orderForPdf?.orderNumber || resolved.orderId}.pdf`,
      content: pdfBuffer,
    },
    href: orderForPdf?.jobId ? `${APP_URL}/jobs/${orderForPdf.jobId}` : undefined,
    replyTo: signerEmail ?? undefined,
    label: 'portal/job',
  })

  return NextResponse.json({ ok: true, agreement: updated })
}
