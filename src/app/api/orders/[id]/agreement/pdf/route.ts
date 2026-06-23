/**
 * GET /api/orders/[id]/agreement/pdf
 *   ?type=RENTAL_AGREEMENT|STAGE_CONTRACT       (default RENTAL_AGREEMENT)
 *   ?doc=tosign|signed|word|redline             (default tosign)
 *
 * Session-gated proxy for a SignedAgreement's stored document. All four
 * fields are PRIVATE blobs that 403 on a direct fetch:
 *   - tosign  → documentToSignUrl  (stage / standing / counter baseline PDF)
 *   - signed  → signedDocumentUrl  (executed copy PDF)
 *   - word    → wordDocumentUrl    (rendered .docx for redline)
 *   - redline → redlineUploadUrl   (client-uploaded redline .docx)
 * One serving path streams whichever the selected field references via the
 * shared `streamPrivateBlobAsResponse` helper (which sets inline vs.
 * attachment disposition by the blob's own content type).
 *
 * Consumers (dashboard, same-origin → cookie session): the order-detail
 * "Doc to sign" / "Signed PDF" / "Last .docx download" / "Client redline"
 * links and the stage-booking-terms "View pre-signed PDF" link.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

const ALLOWED_TYPES = new Set(['RENTAL_AGREEMENT', 'STAGE_CONTRACT'])

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const typeParam = req.nextUrl.searchParams.get('type') || 'RENTAL_AGREEMENT'
  if (!ALLOWED_TYPES.has(typeParam)) {
    return NextResponse.json({ error: 'Invalid contract type' }, { status: 400 })
  }
  const contractType = typeParam as 'RENTAL_AGREEMENT' | 'STAGE_CONTRACT'

  const DOC_FIELDS = {
    tosign: { field: 'documentToSignUrl', ext: 'pdf' },
    signed: { field: 'signedDocumentUrl', ext: 'pdf' },
    word: { field: 'wordDocumentUrl', ext: 'docx' },
    redline: { field: 'redlineUploadUrl', ext: 'docx' },
  } as const
  const doc = req.nextUrl.searchParams.get('doc') || 'tosign'
  const spec = DOC_FIELDS[doc as keyof typeof DOC_FIELDS]
  if (!spec) {
    return NextResponse.json({ error: 'Invalid doc selector' }, { status: 400 })
  }

  const agreement = await prisma.signedAgreement.findUnique({
    where: { orderId_contractType: { orderId: params.id, contractType } },
    select: { documentToSignUrl: true, signedDocumentUrl: true, wordDocumentUrl: true, redlineUploadUrl: true },
  })
  const fileUrl = agreement?.[spec.field]
  if (!fileUrl) {
    return NextResponse.json({ error: 'No document on file for this order' }, { status: 404 })
  }

  return streamPrivateBlobAsResponse({
    fileUrl,
    filename: `${contractType.toLowerCase()}-${doc}-${params.id}.${spec.ext}`,
  })
}
