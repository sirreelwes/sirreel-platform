import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

/**
 * GET /api/drivers/[id]/license/[side] — authed staff view of a stored
 * licence image. `side` is 'front' | 'back'.
 *
 * The blob is private and its URL is never sent to the browser; this
 * proxy is the only way to see the image, so viewing always requires a
 * dashboard session. Same posture as /api/coi/download/[id].
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; side: string }> },
) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const { id, side } = await params
  if (side !== 'front' && side !== 'back') {
    return NextResponse.json({ error: 'side must be front or back' }, { status: 400 })
  }
  const driver = await prisma.driver.findUnique({
    where: { id },
    select: {
      firstName: true, lastName: true,
      licenseFrontUrl: true, licenseFrontMimeType: true,
      licenseBackUrl: true, licenseBackMimeType: true,
    },
  })
  const url = side === 'front' ? driver?.licenseFrontUrl : driver?.licenseBackUrl
  if (!url) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const mime = side === 'front' ? driver?.licenseFrontMimeType : driver?.licenseBackMimeType
  const ext = mime?.includes('png') ? 'png' : mime?.includes('webp') ? 'webp' : 'jpg'
  const who = `${driver?.lastName ?? 'driver'}-${driver?.firstName ?? ''}`.replace(/[^\w-]/g, '')
  return streamPrivateBlobAsResponse({ fileUrl: url, filename: `license-${side}-${who}.${ext}` })
}
