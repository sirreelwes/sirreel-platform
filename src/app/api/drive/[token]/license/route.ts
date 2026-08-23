import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadLicenseImage } from '@/lib/drivers/uploadLicenseImage'
import { readLicenseImage, isExpired, parseCardDate } from '@/lib/drivers/readLicense'
import { evaluateLicenseGate } from '@/lib/drivers/licenseGate'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 12 * 1024 * 1024
const ALLOWED = ['jpeg', 'png', 'webp', 'heic', 'heif']

/**
 * POST /api/drive/[token]/license — licence upload from the driver's JOB
 * page. Same storage and extraction as the per-driver portal route; the
 * difference is the credential: this token identifies a driver *through*
 * their assignment, so one link covers "here's your job" and "here's
 * where you upload".
 *
 * The licence itself is per-PERSON, so this still writes to Driver — a
 * driver who uploads for one job is covered for the next.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const da = await prisma.driverAssignment.findUnique({
      where: { token },
      select: { id: true, expiresAt: true, driverId: true },
    })
    if (!da) return NextResponse.json({ error: 'invalid link' }, { status: 404 })
    if (da.expiresAt && da.expiresAt < new Date()) {
      return NextResponse.json({ error: 'This link has expired — ask for a new one.' }, { status: 410 })
    }

    const form = await req.formData()
    const file = form.get('file') as File | null
    const sideRaw = String(form.get('side') ?? '')
    const side = sideRaw === 'back' ? 'back' : sideRaw === 'front' ? 'front' : null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!side) return NextResponse.json({ error: "side must be 'front' or 'back'" }, { status: 400 })

    const type = file.type || 'application/octet-stream'
    if (!ALLOWED.some((t) => type.includes(t))) {
      return NextResponse.json({ error: 'Please upload a photo (JPG, PNG or HEIC).' }, { status: 400 })
    }
    const bytes = await file.arrayBuffer()
    if (bytes.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: 'That photo is too large — please upload one under 12MB.' }, { status: 400 })
    }
    const data = Buffer.from(bytes)

    const uploaded = await uploadLicenseImage({
      driverId: da.driverId, side,
      filename: file.name || `license-${side}`,
      contentType: type, data,
    })

    const base = side === 'front'
      ? { licenseFrontKey: uploaded.blobKey, licenseFrontUrl: uploaded.fileUrl, licenseFrontMimeType: type }
      : { licenseBackKey: uploaded.blobKey, licenseBackUrl: uploaded.fileUrl, licenseBackMimeType: type }

    let extracted: Record<string, unknown> = {}
    if (side === 'front') {
      // A failed read must never lose the upload — the image is what we
      // actually need on file; extraction is an assist for staff.
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
        console.error('[drive/license] read failed, image kept', e)
      }
    }

    const driver = await prisma.driver.update({
      where: { id: da.driverId },
      data: {
        ...base, ...extracted,
        licenseUploadedAt: new Date(),
        // A new image invalidates any prior human sign-off.
        licenseVerified: false, licenseVerifiedAt: null, licenseVerifiedById: null,
      },
      select: {
        licenseFrontUrl: true, licenseBackUrl: true,
        licenseExpiry: true, licenseExpired: true, licenseVerified: true,
      },
    })

    // Both sides in and unexpired → the assignment is as ready as the
    // driver can make it; the human check still happens at handover.
    const gate = evaluateLicenseGate(driver)
    if (driver.licenseFrontUrl && driver.licenseBackUrl && gate.code !== 'EXPIRED') {
      await prisma.driverAssignment.update({
        where: { id: da.id },
        data: { status: 'READY' },
      })
    }

    return NextResponse.json({ ok: true, side })
  } catch (err) {
    console.error('[drive/license]', err)
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }
}
