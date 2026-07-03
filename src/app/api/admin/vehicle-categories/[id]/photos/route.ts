/**
 * POST /api/admin/vehicle-categories/[id]/photos — multipart upload of ONE
 * gallery photo for a public vehicle page. Validates type + size, writes to
 * the PRIVATE Blob store via the shared uploadPrivateImage writer, then
 * creates the VehicleCategoryPhoto row. The first photo on a vehicle becomes
 * primary automatically; new photos are appended (sortOrder = max + 1).
 *
 * Photos are served back through proxies only (never the raw blob URL):
 * admin preview via GET .../photos/[photoId], public site via
 * /api/public/catalog-image/vehicle-photo/[photoId].
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB — mirrors the asset-category/inventory cap

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const { id } = await params
  const vehicle = await prisma.vehicleCategory.findUnique({ where: { id }, select: { id: true } })
  if (!vehicle) return NextResponse.json({ error: 'vehicle category not found' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
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
      keyPrefix: 'vehicle-category-photos',
      ownerId: id,
      filename: file.name || 'image',
      contentType: file.type,
      data: buf,
    })

    const photo = await prisma.$transaction(async (tx) => {
      const agg = await tx.vehicleCategoryPhoto.aggregate({
        where: { vehicleCategoryId: id },
        _max: { sortOrder: true },
        _count: true,
      })
      return tx.vehicleCategoryPhoto.create({
        data: {
          vehicleCategoryId: id,
          url: fileUrl,
          sortOrder: (agg._max.sortOrder ?? -1) + 1,
          isPrimary: agg._count === 0,
        },
        select: { id: true, sortOrder: true, isPrimary: true, createdAt: true },
      })
    })

    return NextResponse.json({ ok: true, photo })
  } catch (err) {
    console.error('[vehicle-category photos POST] upload failed:', err)
    return NextResponse.json(
      { error: 'Image storage upload failed — please retry; if it persists, the blob store may be misconfigured.' },
      { status: 502 },
    )
  }
}
