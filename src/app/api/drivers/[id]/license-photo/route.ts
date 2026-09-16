/**
 * POST /api/drivers/[id]/license-photo — the fleet tech photographs the
 * driver's licence at the handover, on their own phone.
 *
 * Wes 2026-09-16: "it says for Hugo to hand over his phone to the driver to
 * take a photo of their license. The fleet guys are more comfortable taking
 * the license photo themselves." The only staff path used to be minting the
 * driver's upload link and handing the device across.
 *
 * Front only (nothing in HQ reads the back). Same storage and extraction as
 * the driver's own upload; the difference is who held the card — a fleet tech
 * photographing the physical licence in front of the driver IS the in-person
 * check, so it is marked verified by them rather than asking for a second
 * "looks good" tap. With `inspectionId` it also fills the check-out's
 * DRIVERS_LICENSE slot, so the filed walk-around shows who drove off.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVehicleHandoverAccess } from '@/lib/fleet/requireVehicleHandoverAccess'
import { uploadLicenseImage } from '@/lib/drivers/uploadLicenseImage'
import { readLicenseImage, isExpired, parseCardDate } from '@/lib/drivers/readLicense'
import { DRIVERS_LICENSE_POSITION } from '@/lib/fleet/photoPositions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_BYTES = 12 * 1024 * 1024
const ALLOWED = ['jpeg', 'png', 'webp', 'heic', 'heif']

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVehicleHandoverAccess()
  if (!auth.ok) return auth.response
  const { id } = await params

  const driver = await prisma.driver.findUnique({ where: { id }, select: { id: true } })
  if (!driver) return NextResponse.json({ error: 'Driver not found' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No photo received' }, { status: 400 })
  const type = file.type || 'application/octet-stream'
  if (!ALLOWED.some((t) => type.includes(t))) {
    return NextResponse.json({ error: 'That is not a photo (JPG, PNG or HEIC).' }, { status: 400 })
  }
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength > MAX_BYTES) return NextResponse.json({ error: 'Photo is over 12MB.' }, { status: 400 })
  const data = Buffer.from(bytes)

  const uploaded = await uploadLicenseImage({
    driverId: id,
    side: 'front',
    filename: file.name || 'license-front',
    contentType: type,
    data,
  })

  // A failed read never loses the photo — the image is the record.
  let extracted: Record<string, unknown> = {}
  try {
    const read = await readLicenseImage({ data, mimeType: type })
    extracted = {
      licenseAiReview: read as object,
      licenseReviewAt: new Date(),
      licenseExpired: isExpired(read.expiryDate),
      licenseNumber: read.licenseNumber ? String(read.licenseNumber).slice(0, 30) : undefined,
      licenseState: read.state ? String(read.state).slice(0, 5) : undefined,
      licenseExpiry: parseCardDate(read.expiryDate) ?? undefined,
      dateOfBirth: parseCardDate(read.dateOfBirth) ?? undefined,
      licenseClass: read.licenseClass ? String(read.licenseClass).slice(0, 10) : undefined,
      licenseEndorsements: read.endorsements ? String(read.endorsements).slice(0, 60) : undefined,
      licenseRestrictions: read.restrictions ? String(read.restrictions).slice(0, 60) : undefined,
    }
  } catch (e) {
    console.error('[drivers/license-photo] read failed, image kept', e)
  }

  const now = new Date()
  await prisma.driver.update({
    where: { id },
    data: {
      licenseFrontKey: uploaded.blobKey,
      licenseFrontUrl: uploaded.fileUrl,
      licenseFrontMimeType: type,
      ...extracted,
      licenseUploadedAt: now,
      licenseVerified: true,
      licenseVerifiedAt: now,
      licenseVerifiedById: auth.userId,
    },
  })

  // The same shot into the check-out walk-around's licence slot.
  const inspectionId = form?.get('inspectionId')
  let slotFilled = false
  if (typeof inspectionId === 'string' && inspectionId) {
    const insp = await prisma.inspection.findUnique({ where: { id: inspectionId }, select: { id: true, type: true } })
    if (insp?.type === 'CHECKOUT') {
      await prisma.inspectionPhoto.create({
        data: {
          inspectionId: insp.id,
          fileUrl: uploaded.fileUrl,
          filename: `license-front-${id}`.slice(0, 80),
          contentType: type,
          position: DRIVERS_LICENSE_POSITION,
          uploadedBy: auth.userId,
        },
      })
      slotFilled = true
    }
  }

  return NextResponse.json({ ok: true, slotFilled })
}
