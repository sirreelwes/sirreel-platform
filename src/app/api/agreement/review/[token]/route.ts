/**
 * GET /api/agreement/review/[token] — the client's counsel downloads their
 * own negotiated agreement.
 *
 *   ?format=pdf   → the agreement as PDF (default)
 *   ?format=docx  → the agreement as Word, composed from the clause data
 *
 * No session. The TOKEN is the credential (counselReviewToken.ts), it names
 * ONE agreement, and it expires. 404 for anything that does not verify —
 * never a message distinguishing "expired" from "never existed" from "not a
 * negotiated client", because the caller is unauthenticated and the
 * difference is information.
 *
 * Rendered LIVE from the registry rather than served from the filed blob:
 * this link exists while §32 is still moving, so counsel opening it after a
 * change reads the corrected document (see counselReviewPacket.ts).
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyCounselReviewToken } from '@/lib/contracts/counselReviewToken'
import { buildCounselReviewPacket } from '@/lib/contracts/counselReviewPacket'
import { generateNegotiatedAgreementPdf } from '@/lib/contracts/generateNegotiatedAgreementPdf'
import {
  generateNegotiatedAgreementDocx,
  negotiatedDocxFilename,
  NEGOTIATED_DOCX_MIME,
} from '@/lib/contracts/generateNegotiatedAgreementDocx'

export const dynamic = 'force-dynamic'
// Composing the PDF walks 31 clauses through react-pdf; the default 10s is
// tight on a cold lambda.
export const maxDuration = 60

const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 })

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const payload = verifyCounselReviewToken(params.token)
  if (!payload) return notFound()

  const packet = await buildCounselReviewPacket(payload.companyAgreementId)
  if (!packet) return notFound()

  const format = req.nextUrl.searchParams.get('format') === 'docx' ? 'docx' : 'pdf'
  const safe = (s: string) => s.replace(/[^A-Za-z0-9 ._-]+/g, '').trim().replace(/\s+/g, '-')

  if (format === 'docx') {
    const buf = generateNegotiatedAgreementDocx({
      agreement: packet.agreement,
      companyName: packet.companyName,
    })
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': NEGOTIATED_DOCX_MIME,
        'Content-Disposition': `attachment; filename="${negotiatedDocxFilename(packet.agreement, packet.companyName)}"`,
        'Content-Length': String(buf.length),
        'Cache-Control': 'no-store',
      },
    })
  }

  const buf = await generateNegotiatedAgreementPdf({
    agreement: packet.agreement,
    companyName: packet.companyName,
  })
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      // inline: the page embeds this in a viewer. The Word button is the
      // one that downloads.
      'Content-Disposition': `inline; filename="${safe(packet.title)}-${safe(packet.companyName)}.pdf"`,
      'Content-Length': String(buf.length),
      'Cache-Control': 'no-store',
    },
  })
}
