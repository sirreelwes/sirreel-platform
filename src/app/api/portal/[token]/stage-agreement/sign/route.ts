import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { buildStageContractProps } from '@/lib/contracts/buildStageContractProps'
import { generateSignedStageContractPdf } from '@/lib/contracts/generateStageContractPdf'
import {
  JOB_SESSION_COOKIE,
  verifyJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'

export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/[token]/stage-agreement/sign
 *
 * Client countersign for a STAGE_CONTRACT SignedAgreement. The Licensor
 * side is pre-filled at generation time; this endpoint records the
 * Producer-side acknowledgement (typed name + checkbox).
 *
 * Auth: Job Page portal session cookie (the same one used by
 * /api/portal/job/data). The [token] route param is kept for URL-shape
 * compatibility with the rental-agreement sign endpoint but isn't
 * consulted — the cookie identifies the order. Stage contracts don't
 * support the redline / negotiated round-trip yet, so the flow is
 * single-shot: client clicks "Sign", row flips to SIGNED_BASELINE.
 *
 * On sign we render the EXECUTED PDF — the same contract body the client
 * reviewed (rebuilt from the order via buildStageContractProps, so the two
 * copies can't drift) plus the Producer signature, e-sign attestation and
 * audit trail — upload it, and point signedDocumentUrl at it.
 * documentToSignUrl (the pre-sign copy) is left untouched.
 *
 * A render/upload failure ABORTS the sign: we never flip to a SIGNED status
 * without a signed artifact, so the client can safely retry.
 */

interface SignBody {
  signerName?: unknown
  signerTitle?: unknown
  signerEmail?: unknown
  acknowledgmentText?: unknown
  signatureImageData?: unknown
}

export async function POST(req: NextRequest, _params: { params: { token: string } }) {
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
    where: { orderId_contractType: { orderId: resolved.orderId, contractType: 'STAGE_CONTRACT' } },
    select: { id: true, status: true, documentToSignUrl: true },
  })
  if (!agreement) {
    return NextResponse.json(
      { error: 'No stage contract has been generated for this order yet' },
      { status: 404 },
    )
  }
  if (!agreement.documentToSignUrl) {
    return NextResponse.json(
      { error: 'Stage contract PDF is missing — ask your SirReel rep to regenerate it' },
      { status: 409 },
    )
  }
  if (agreement.status === 'SIGNED_BASELINE' || agreement.status === 'SIGNED_NEGOTIATED') {
    return NextResponse.json({ error: 'Stage contract is already signed' }, { status: 409 })
  }

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null
  const ua = req.headers.get('user-agent') || null
  const signedAt = new Date()
  const signerTitle = typeof body.signerTitle === 'string' ? body.signerTitle.trim() || null : null
  const signerEmail = typeof body.signerEmail === 'string' ? body.signerEmail.trim() || null : null
  const signatureImageData =
    typeof body.signatureImageData === 'string' ? body.signatureImageData : null

  // Rebuild the contract body from the order so the executed copy is the
  // same document the client reviewed, then render it WITH the signature.
  const rendered = await buildStageContractProps(resolved.orderId)
  if (!rendered) {
    return NextResponse.json(
      { error: 'Stage booking terms are missing — ask your SirReel rep to regenerate the contract' },
      { status: 409 },
    )
  }

  let uploadedUrl: string
  try {
    const pdfBuffer = await generateSignedStageContractPdf({
      party: rendered.party,
      terms: rendered.terms,
      generatedAt: signedAt,
      signature: {
        signerName,
        signerTitle,
        signerEmail,
        signatureImageDataUri: signatureImageData,
        acknowledgmentText,
        signedAt,
        ipAddress: ip,
        userAgent: ua,
      },
    })
    const blobKey = `stage-contracts/${resolved.orderId}/signed-${signedAt.getTime()}.pdf`
    // Private store (see generate-stage-contract): a `public` put throws
    // against the prod store. Served through the gated proxy.
    const uploaded = await put(blobKey, pdfBuffer, {
      access: 'private' as 'public',
      contentType: 'application/pdf',
    })
    uploadedUrl = uploaded.url
  } catch (err) {
    console.error('[stage-agreement/sign] signed PDF render/upload failed:', err)
    return NextResponse.json(
      { error: 'Could not produce the signed contract — nothing was recorded. Please try again.' },
      { status: 502 },
    )
  }

  const updated = await prisma.signedAgreement.update({
    where: { id: agreement.id },
    data: {
      status: 'SIGNED_BASELINE',
      signedAt,
      signerName,
      signerTitle,
      signerEmail,
      signatureImageData,
      acknowledgmentText,
      signerIpAddress: ip,
      signerUserAgent: ua,
      signedDocumentUrl: uploadedUrl,
    },
    select: { id: true, status: true, signedAt: true, signedDocumentUrl: true },
  })

  return NextResponse.json({ ok: true, agreement: updated })
}
