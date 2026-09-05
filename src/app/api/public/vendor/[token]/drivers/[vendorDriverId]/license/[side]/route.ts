/**
 * GET — the partner views a licence image of one of THEIR roster drivers.
 * Token-scoped: the driver must belong to the booking's vendor. The blob URL
 * itself never leaves the server.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { token: string; vendorDriverId: string; side: string } }) {
  const { token, vendorDriverId, side } = params
  if (!token || token.length < 32) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (side !== 'front' && side !== 'back') return NextResponse.json({ error: 'side must be front or back' }, { status: 400 })
  const sub = await prisma.subRental.findFirst({ where: { vendorToken: token }, select: { vendorId: true } })
  if (!sub) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const d = await prisma.vendorDriver.findFirst({
    where: { id: vendorDriverId, vendorId: sub.vendorId },
    select: { firstName: true, lastName: true, licenseFrontUrl: true, licenseFrontMimeType: true, licenseBackUrl: true, licenseBackMimeType: true },
  })
  const url = side === 'front' ? d?.licenseFrontUrl : d?.licenseBackUrl
  if (!url) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const mime = side === 'front' ? d?.licenseFrontMimeType : d?.licenseBackMimeType
  const ext = mime?.includes('png') ? 'png' : mime?.includes('webp') ? 'webp' : 'jpg'
  const who = `${d?.lastName ?? 'driver'}-${d?.firstName ?? ''}`.replace(/[^\w-]/g, '')
  return streamPrivateBlobAsResponse({ fileUrl: url, filename: `license-${side}-${who}.${ext}` })
}
