/**
 * /api/sub-rentals/vehicles/[id]/photos
 *
 *   GET  → photo rows for the gallery (ids + order only; the bytes come
 *          from the per-photo proxy below)
 *   POST → multipart upload of ONE photo
 *
 * Storage contract mirrors VehicleCategoryPhoto: bytes go to the
 * PRIVATE blob store via uploadPrivateImage, and `url` is never handed
 * to a browser — every render goes through
 * GET .../photos/[photoId], which re-checks the caller's session.
 * First photo on a vehicle becomes primary; the rest append.
 *
 * Auth: requireSubVehicleAccess, same as the rest of the roster.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'
import { requireSubVehicleAccess } from '@/lib/sub-rentals/auth'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB — mirrors the vehicle-catalog cap

export async function GET(_req: NextRequest, { params }: Params) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate

  const photos = await prisma.subcontractedVehiclePhoto.findMany({
    where: { vehicleId: params.id },
    select: { id: true, caption: true, sortOrder: true, isPrimary: true, createdAt: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json({ photos })
}

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate

  const vehicle = await prisma.subcontractedVehicle.findUnique({
    where: { id: params.id },
    select: { id: true },
  })
  if (!vehicle) return NextResponse.json({ error: 'vehicle not found' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const caption = form?.get('caption')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 })
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `unsupported image type "${file.type}" — use jpg / png / webp / heic` },
      { status: 415 },
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `image is ${(file.size / 1024 / 1024).toFixed(1)} MB; cap is ${MAX_BYTES / 1024 / 1024} MB` },
      { status: 413 },
    )
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const { fileUrl } = await uploadPrivateImage({
      keyPrefix: 'subcontracted-vehicle-photos',
      ownerId: params.id,
      filename: file.name || 'image',
      contentType: file.type,
      data: buf,
    })

    const photo = await prisma.$transaction(async (tx) => {
      const agg = await tx.subcontractedVehiclePhoto.aggregate({
        where: { vehicleId: params.id },
        _max: { sortOrder: true },
        _count: true,
      })
      return tx.subcontractedVehiclePhoto.create({
        data: {
          vehicleId: params.id,
          url: fileUrl,
          caption: typeof caption === 'string' && caption.trim() ? caption.trim() : null,
          sortOrder: (agg._max.sortOrder ?? -1) + 1,
          isPrimary: agg._count === 0,
        },
        select: { id: true, caption: true, sortOrder: true, isPrimary: true, createdAt: true },
      })
    })

    return NextResponse.json({ ok: true, photo })
  } catch (err) {
    console.error('[subcontracted vehicle photos POST] upload failed:', err)
    return NextResponse.json(
      { error: 'Image storage upload failed — please retry; if it persists, the blob store may be misconfigured.' },
      { status: 502 },
    )
  }
}
