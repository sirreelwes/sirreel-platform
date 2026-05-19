import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
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
 * MVP scope: we do not regenerate the PDF with the client's signature
 * burned in. We capture the typed name + acknowledgement metadata on
 * the SignedAgreement row, and the original pre-signed baseline PDF
 * stays as the document of record. A follow-up commit can replace this
 * with a render-burned-in flow (mirroring the rental agreement) once
 * the burn-in step is generalized.
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

  const updated = await prisma.signedAgreement.update({
    where: { id: agreement.id },
    data: {
      status: 'SIGNED_BASELINE',
      signedAt: new Date(),
      signerName,
      signerTitle: typeof body.signerTitle === 'string' ? body.signerTitle.trim() || null : null,
      signerEmail: typeof body.signerEmail === 'string' ? body.signerEmail.trim() || null : null,
      signatureImageData: typeof body.signatureImageData === 'string' ? body.signatureImageData : null,
      acknowledgmentText,
      signerIpAddress: ip,
      signerUserAgent: ua,
      // MVP: signedDocumentUrl stays equal to documentToSignUrl. Follow-up
      // commit will burn the producer signature into the PDF and upload
      // a separate signed copy.
      signedDocumentUrl: agreement.documentToSignUrl,
    },
    select: { id: true, status: true, signedAt: true, signedDocumentUrl: true },
  })

  return NextResponse.json({ ok: true, agreement: updated })
}
