/**
 * GET /api/public/unit/[token]/photo/[photoId]
 *
 * Image bytes for the unlisted subcontracted-vehicle page. Deliberately
 * token-scoped rather than another `kind` on /api/public/catalog-image:
 * that proxy resolves public CATALOG rows by id alone, which is right for
 * published vehicles but wrong here — these photos should be no more
 * reachable than the page itself. The token gates the image exactly as it
 * gates the page, and a photo id on its own is worthless.
 *
 * Bytes come from the PRIVATE blob store via the shared stream helper, so
 * the raw blob URL is never handed to a browser and still 403s directly.
 */
import { NextRequest, NextResponse } from 'next/server'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'
import { getPublicUnitPhotoUrl } from '@/lib/sub-rentals/publicUnit'

export const dynamic = 'force-dynamic'

type Params = { params: { token: string; photoId: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const fileUrl = await getPublicUnitPhotoUrl(params.token, params.photoId)
  if (!fileUrl) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return streamPrivateBlobAsResponse({ fileUrl, filename: `${params.photoId}.jpg` })
}
