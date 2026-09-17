/**
 * GET /api/fleet/photos/[photoId] — session-gated streaming proxy for
 * inspection photos (Sprint 2A). Internal-staff-only: any signed-in HQ
 * session may view (the internal order page renders thumbnails), but
 * there is NO public/portal path to these bytes — the route is not in
 * any middleware allow-list and the blob itself is private.
 *
 * `?download=1` (2026-09-17, Hugo: "save a photo from HQ to do a damage
 * report") hands back a COPY to keep, as an attachment: the date and
 * time drawn along the bottom (lib/fleet/stampPhoto — the stored
 * original is untouched) and a filename that says what it is
 * ("Cube-27_check-out_05-driver-side-rear_2026-09-16_14-14.jpg") instead
 * of the upload's random name. If the stamp cannot be drawn (HEIC, or
 * canvas unavailable) the raw file goes out under the same name, so the
 * save never fails for want of a caption.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse, readPrivateBlobBuffer } from '@/lib/claims/streamBlob'
import { edgeOf } from '@/lib/fleet/inspectionHistory'
import { photoStampCaption, photoDownloadName } from '@/lib/fleet/photoStamp'
import { stampPhoto } from '@/lib/fleet/stampPhoto'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Params = { params: Promise<{ photoId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const { photoId } = await params
  const download = req.nextUrl.searchParams.get('download') === '1'

  const photo = await prisma.inspectionPhoto.findUnique({
    where: { id: photoId },
    select: {
      fileUrl: true,
      filename: true,
      contentType: true,
      position: true,
      createdAt: true,
      inspection: { select: { type: true, asset: { select: { unitName: true } } } },
    },
  })
  if (!photo) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (!download) {
    return streamPrivateBlobAsResponse({
      fileUrl: photo.fileUrl,
      filename: photo.filename || 'inspection-photo.jpg',
    })
  }

  const stampArgs = {
    unitName: photo.inspection.asset.unitName,
    edge: edgeOf(photo.inspection.type),
    position: photo.position,
    takenAt: photo.createdAt,
  }
  const raw = await readPrivateBlobBuffer(photo.fileUrl)
  if (!raw) {
    // Same fallback the inline path gives — the blob is the problem, not
    // the request, and streamPrivateBlobAsResponse says which.
    return streamPrivateBlobAsResponse({
      fileUrl: photo.fileUrl,
      filename: photoDownloadName({ ...stampArgs, contentType: photo.contentType }),
      forceDownload: true,
    })
  }
  const stamped = await stampPhoto({
    bytes: raw,
    contentType: photo.contentType,
    caption: photoStampCaption(stampArgs),
  })
  const bytes = stamped ? stamped.bytes : raw
  const contentType = stamped ? stamped.contentType : photo.contentType || 'application/octet-stream'
  const name = photoDownloadName({ ...stampArgs, contentType })
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
      'X-Photo-Stamped': stamped ? '1' : '0',
    },
  })
}
