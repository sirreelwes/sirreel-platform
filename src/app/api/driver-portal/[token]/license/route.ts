import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadLicenseImage } from '@/lib/drivers/uploadLicenseImage'
import { readLicenseImage, isExpired, parseCardDate } from '@/lib/drivers/readLicense'

export const dynamic = 'force-dynamic'

// Phone cameras produce big files; anything over this is a mistake
// (a video, a PDF scan of a whole folder) rather than a licence photo.
const MAX_BYTES = 12 * 1024 * 1024
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

/**
 * POST /api/driver-portal/[token]/license — the driver (or staff on a
 * tablet at pickup) uploads one side of the licence. Multipart:
 *   file: the image
 *   side: 'front' | 'back'
 *
 * NO LOGIN — the token is the credential, which is why this route is
 * narrow: it accepts one image, stores it PRIVATE, and returns only a
 * coarse result. It never returns the extracted licence data, so a link
 * cannot be used to read back what was uploaded.
 *
 * The FRONT is what gets read (that is where the printed fields are).
 * The back is stored for the record and for a future PDF417 barcode
 * cross-check; we do not decode it today. See src/lib/drivers/readLicense.ts
 * for why none of this amounts to "the licence is valid".
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const driver = await prisma.driver.findUnique({
      where: { portalToken: token },
      select: { id: true, portalExpiresAt: true },
    })
    if (!driver) return NextResponse.json({ error: 'invalid link' }, { status: 404 })
    if (driver.portalExpiresAt && driver.portalExpiresAt < new Date()) {
      return NextResponse.json({ error: 'This link has expired — ask SirReel for a new one.' }, { status: 410 })
    }

    const form = await req.formData()
    const file = form.get('file') as File | null
    const sideRaw = String(form.get('side') ?? '')
    const side = sideRaw === 'back' ? 'back' : sideRaw === 'front' ? 'front' : null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!side) return NextResponse.json({ error: "side must be 'front' or 'back'" }, { status: 400 })

    const type = file.type || 'application/octet-stream'
    if (!ALLOWED.some((t) => type.includes(t.split('/')[1]))) {
      return NextResponse.json({ error: 'Please upload a photo (JPG, PNG or HEIC).' }, { status: 400 })
    }
    const bytes = await file.arrayBuffer()
    if (bytes.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: 'That photo is too large — please upload one under 12MB.' }, { status: 400 })
    }
    const data = Buffer.from(bytes)

    const uploaded = await uploadLicenseImage({
      driverId: driver.id,
      side,
      filename: file.name || `license-${side}`,
      contentType: type,
      data,
    })

    const base = side === 'front'
      ? { licenseFrontKey: uploaded.blobKey, licenseFrontUrl: uploaded.fileUrl, licenseFrontMimeType: type }
      : { licenseBackKey: uploaded.blobKey, licenseBackUrl: uploaded.fileUrl, licenseBackMimeType: type }

    // Only the front carries the printed fields worth reading. A failed
    // read must NOT lose the upload — the image is the thing we actually
    // need on file, so extraction failure is swallowed and left for staff.
    let extracted: Record<string, unknown> = {}
    if (side === 'front') {
      try {
        const read = await readLicenseImage({ data, mimeType: type })
        const expired = isExpired(read.expiryDate)
        extracted = {
          licenseAiReview: read as object,
          licenseReviewAt: new Date(),
          licenseExpired: expired,
          licenseNumber: read.licenseNumber ? String(read.licenseNumber).slice(0, 30) : undefined,
          licenseState: read.state ? String(read.state).slice(0, 5) : undefined,
          licenseExpiry: parseCardDate(read.expiryDate) ?? undefined,
          dateOfBirth: parseCardDate(read.dateOfBirth) ?? undefined,
          licenseClass: read.licenseClass ? String(read.licenseClass).slice(0, 10) : undefined,
          licenseEndorsements: read.endorsements ? String(read.endorsements).slice(0, 60) : undefined,
          licenseRestrictions: read.restrictions ? String(read.restrictions).slice(0, 60) : undefined,
        }
      } catch (e) {
        console.error('[driver-portal/license] read failed, image kept', e)
      }
    }

    await prisma.driver.update({
      where: { id: driver.id },
      data: {
        ...base,
        ...extracted,
        licenseUploadedAt: new Date(),
        // A new image invalidates any prior human sign-off.
        licenseVerified: false,
        licenseVerifiedAt: null,
        licenseVerifiedById: null,
      },
    })

    // Coarse result only — never the extracted fields.
    return NextResponse.json({ ok: true, side })
  } catch (err: unknown) {
    console.error('[driver-portal/license]', err)
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }
}
