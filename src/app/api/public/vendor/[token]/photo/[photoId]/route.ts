/**
 * GET /api/public/vendor/[token]/photo/[photoId] — image bytes for the vendor
 * page. Scoped by the VENDOR token, so a vendor link reaches only the unit on
 * that sub-rental and a client's /unit token can't be used here (or vice
 * versa). Bytes come from the private blob store via the shared stream helper.
 */
import { NextRequest, NextResponse } from 'next/server'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'
import { getVendorPhotoUrl } from '@/lib/sub-rentals/potentialSubRental'

export const dynamic = 'force-dynamic'

type Params = { params: { token: string; photoId: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const fileUrl = await getVendorPhotoUrl(params.token, params.photoId)
  if (!fileUrl) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return streamPrivateBlobAsResponse({ fileUrl, filename: `${params.photoId}.jpg` })
}
