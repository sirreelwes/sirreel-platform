/** GET — staff view of a partner driver's licence image (requireSubRentalAccess). */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSubRentalAccess } from '@/lib/sub-rentals/auth'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string; side: string } }) {
  const gate = await requireSubRentalAccess()
  if (gate instanceof NextResponse) return gate
  const { id, side } = params
  if (side !== 'front' && side !== 'back') return NextResponse.json({ error: 'side must be front or back' }, { status: 400 })
  const d = await prisma.vendorDriver.findUnique({
    where: { id },
    select: { firstName: true, lastName: true, licenseFrontUrl: true, licenseFrontMimeType: true, licenseBackUrl: true, licenseBackMimeType: true },
  })
  const url = side === 'front' ? d?.licenseFrontUrl : d?.licenseBackUrl
  if (!url) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const mime = side === 'front' ? d?.licenseFrontMimeType : d?.licenseBackMimeType
  const ext = mime?.includes('png') ? 'png' : mime?.includes('webp') ? 'webp' : 'jpg'
  const who = `${d?.lastName ?? 'driver'}-${d?.firstName ?? ''}`.replace(/[^\w-]/g, '')
  return streamPrivateBlobAsResponse({ fileUrl: url, filename: `license-${side}-${who}.${ext}` })
}
