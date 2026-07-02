/**
 * GET /api/fleet/photos/[photoId] — session-gated streaming proxy for
 * inspection photos (Sprint 2A). Internal-staff-only: any signed-in HQ
 * session may view (the internal order page renders thumbnails), but
 * there is NO public/portal path to these bytes — the route is not in
 * any middleware allow-list and the blob itself is private.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ photoId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const { photoId } = await params
  const photo = await prisma.inspectionPhoto.findUnique({
    where: { id: photoId },
    select: { fileUrl: true, filename: true },
  })
  if (!photo) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return streamPrivateBlobAsResponse({
    fileUrl: photo.fileUrl,
    filename: photo.filename || 'inspection-photo.jpg',
  })
}
