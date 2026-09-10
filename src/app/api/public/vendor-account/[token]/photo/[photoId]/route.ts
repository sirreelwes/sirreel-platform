/**
 * GET /api/public/vendor-account/[token]/photo/[photoId] — image bytes for the
 * partner's ACCOUNT page.
 *
 * Distinct from /api/public/vendor/[token]/photo/[photoId], which is scoped by
 * a SubRental's per-booking vendorToken and so only reaches units on that one
 * booking. This one is scoped by the account token to units the partner OWNS,
 * which is what the fleet list on the account page needs.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'
import { vendorByToken } from '@/lib/sub-rentals/vendorAccountActions'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { token: string; photoId: string } }) {
  const v = await vendorByToken(params.token)
  if (!v) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const photo = await prisma.subcontractedVehiclePhoto.findFirst({
    where: { id: params.photoId, vehicle: { vendorId: v.id } },
    select: { url: true },
  })
  if (!photo) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return streamPrivateBlobAsResponse({ fileUrl: photo.url, filename: `${params.photoId}.jpg` })
}
